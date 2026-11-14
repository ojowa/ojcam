package com.ojowacam.mobile

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OjowacamAudio"
    private val permissions = AndroidPermissions(reactContext)
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private var audioThread: Thread? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    private val sampleRate = 48000
    private val channelConfig = AudioFormat.CHANNEL_IN_STEREO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT

    // RMS of the captured (pre-gain) signal, normalized to full-scale sine
    // RMS (~23170) so getAudioLevels() reports a real 0..1 meter.
    @Volatile
    private var lastLevel = 0f

    @Volatile
    private var noiseSuppressionEnabled = true

    @Volatile
    private var gain = 1.0f

    // Callback for PCM audio data -> Opus encoder / WebRTC audio track
    var onAudioData: ((ByteArray, Long) -> Unit)? = null

    override fun getName(): String = "OjowacamAudio"

    @ReactMethod
    fun startRecording(promise: Promise) {
        permissions.ensureMicrophone(promise) {
            startRecordingInternal(promise)
        }
    }

    private fun startRecordingInternal(promise: Promise) {
        try {
            if (isRecording) { promise.resolve(true); return }
            val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                minBufferSize * 2
            )
            if (audioRecord!!.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord?.release()
                audioRecord = null
                promise.reject("E_AUDIO_PERMISSION", "Microphone unavailable or permission denied", null)
                return
            }
            attachNoiseSuppressor()
            audioRecord!!.startRecording()
            isRecording = true
            audioThread = Thread {
                val buffer = ByteArray(minBufferSize * 2)
                while (isRecording) {
                    val read = audioRecord?.read(buffer, 0, buffer.size) ?: break
                    if (read > 0) {
                        applyGainAndMeasure(buffer, read)
                        val pcmData = buffer.copyOfRange(0, read)
                        emitAudioData(pcmData)
                        onAudioData?.invoke(pcmData, System.currentTimeMillis())
                    }
                }
            }
            audioThread!!.start()
            promise.resolve(true)
        } catch (e: SecurityException) {
            isRecording = false
            promise.reject("E_AUDIO_PERMISSION", "Microphone permission not granted", e)
        } catch (e: Exception) {
            isRecording = false
            promise.reject("AUDIO_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        try {
            stopRecordingInternal()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_AUDIO_ERROR", e.message, e)
        }
    }

    private fun stopRecordingInternal() {
        isRecording = false
        lastLevel = 0f
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        detachNoiseSuppressor()
        audioThread?.interrupt()
        audioThread = null
    }

    /**
     * Enable/disable the platform noise suppressor (attached to the active
     * capture session when one is running).
     */
    @ReactMethod
    fun setNoiseSuppression(enabled: Boolean, promise: Promise) {
        try {
            noiseSuppressionEnabled = enabled
            if (isRecording) {
                detachNoiseSuppressor()
                if (enabled) attachNoiseSuppressor()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NOISE_SUPPRESSION_ERROR", e.message, e)
        }
    }

    /**
     * Linear mic gain (1.0 = unity, up to 8.0). Applied to the captured
     * samples before they are emitted, with hard clipping at int16 limits.
     */
    @ReactMethod
    fun setGain(value: Float, promise: Promise) {
        gain = value.coerceIn(0.1f, 8.0f)
        promise.resolve(true)
    }

    @ReactMethod
    fun getAudioLevels(promise: Promise) {
        try {
            promise.resolve(if (isRecording) lastLevel.toDouble() else 0.0)
        } catch (e: Exception) {
            promise.reject("AUDIO_LEVELS_ERROR", e.message, e)
        }
    }

    fun isRecording(): Boolean = isRecording

    override fun invalidate() {
        try {
            stopRecordingInternal()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop audio recording during teardown", e)
        }
        super.invalidate()
    }

    // -------------------------------------------------------------------------
    // Capture-loop helpers
    // -------------------------------------------------------------------------

    /** Applies gain in place and updates [lastLevel] with the pre-gain RMS. */
    private fun applyGainAndMeasure(buffer: ByteArray, length: Int) {
        val shortCount = length / 2
        if (shortCount <= 0) return
        val shorts = ShortArray(shortCount)
        ByteBuffer.wrap(buffer, 0, length).order(ByteOrder.LITTLE_ENDIAN)
            .asShortBuffer().get(shorts)

        var sumSq = 0.0
        for (s in shorts) {
            val v = s.toInt()
            sumSq += v.toDouble() * v.toDouble()
        }
        val rms = Math.sqrt(sumSq / shortCount)
        // Normalize against full-scale sine RMS (32768/sqrt(2) ~= 23170).
        lastLevel = (rms / 23170.0).coerceIn(0.0, 1.0).toFloat()

        val g = gain
        if (g != 1.0f) {
            val out = ByteBuffer.wrap(buffer, 0, length).order(ByteOrder.LITTLE_ENDIAN)
            for (i in shorts.indices) {
                val amplified = (shorts[i].toInt() * g).toInt().coerceIn(-32768, 32767)
                out.putShort(amplified.toShort())
            }
        }
    }

    /** Emits a base64 PCM chunk to JS as the "onAudioData" event. */
    private fun emitAudioData(pcm: ByteArray) {
        try {
            val context = reactApplicationContext
            val map = Arguments.createMap()
            map.putString("data", Base64.encodeToString(pcm, Base64.NO_WRAP))
            map.putDouble("timestampMs", System.currentTimeMillis().toDouble())
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onAudioData", map)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to emit onAudioData", e)
        }
    }

    private fun attachNoiseSuppressor() {
        val record = audioRecord ?: return
        if (!noiseSuppressionEnabled) return
        if (!NoiseSuppressor.isAvailable()) {
            Log.i(TAG, "NoiseSuppressor unavailable on this device")
            return
        }
        try {
            noiseSuppressor?.release()
            noiseSuppressor = NoiseSuppressor.create(record.audioSessionId)
            noiseSuppressor?.enabled = true
            Log.i(TAG, "NoiseSuppressor attached")
        } catch (e: Exception) {
            Log.w(TAG, "NoiseSuppressor attach failed: ${e.message}")
            noiseSuppressor = null
        }
    }

    private fun detachNoiseSuppressor() {
        try {
            noiseSuppressor?.release()
        } catch (e: Exception) {
            Log.w(TAG, "NoiseSuppressor release failed: ${e.message}")
        }
        noiseSuppressor = null
    }
}
