package com.ojowacam.mobile

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class AudioModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val TAG = "OjowacamAudio"
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private var audioThread: Thread? = null

    private val sampleRate = 48000
    private val channelConfig = AudioFormat.CHANNEL_IN_STEREO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT

    override fun getName(): String = "OjowacamAudio"

    @ReactMethod
    fun startRecording(promise: Promise) {
        try {
            val minBufferSize = AudioRecord.getMinBufferSize(
                sampleRate, channelConfig, audioFormat
            )

            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                minBufferSize * 2
            )

            audioRecord!!.startRecording()
            isRecording = true

            audioThread = Thread {
                val buffer = ByteArray(minBufferSize * 2)
                while (isRecording) {
                    val read = audioRecord!!.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        // TODO: Send PCM audio data to Opus encoder / WebRTC audio track
                        Log.d(TAG, "Captured $read bytes of audio")
                    }
                }
            }
            audioThread!!.start()

            promise.resolve(true)
        } catch (e: Exception) {
            isRecording = false
            promise.reject("AUDIO_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        try {
            isRecording = false
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
            audioThread?.interrupt()
            audioThread = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_AUDIO_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getAudioLevels(promise: Promise) {
        // TODO: Return current audio level for VU meter
        promise.resolve(0.5)
    }

    override fun onDestroy() {
        stopRecording(com.facebook.react.bridge.Promise() { _, _ -> })
        super.onDestroy()
    }
}
