package com.ojowacam.mobile

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import java.nio.ByteBuffer

class EncoderModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OjowacamEncoder"
    private var mediaCodec: MediaCodec? = null
    private var isEncoding = false
    private var encodeThread: Thread? = null
    private var width = 0
    private var height = 0

    // Callback for encoded H264 NAL units -> WebRTC video track
    var onEncodedFrame: ((ByteArray) -> Unit)? = null

    override fun getName(): String = "OjowacamEncoder"

    private fun buildFormat(width: Int, height: Int, bitrate: Int, fps: Int, colorFormat: Int): MediaFormat {
        val format = MediaFormat.createVideoFormat("video/avc", width, height)
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, colorFormat)
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        return format
    }

    @ReactMethod
    fun initEncoder(width: Int, height: Int, bitrate: Int, fps: Int, promise: Promise) {
        var stage = "release"
        try {
            releaseEncoderInternal()
            this.width = width
            this.height = height

            stage = "format"
            val flexible = MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible
            val semiPlanar = MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar

            stage = "create"
            mediaCodec = MediaCodec.createEncoderByType("video/avc")
            val codec = mediaCodec!!

            stage = "configure"
            try {
                val format = buildFormat(width, height, bitrate, fps, flexible)
                format.setInteger(MediaFormat.KEY_LEVEL, 51)
                format.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh)
                codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            } catch (first: Exception) {
                // Some vendors reject explicit profile/level or the flexible
                // color format — retry with progressively looser settings.
                Log.w(TAG, "configure(High@5.1,flexible) failed: ${first.javaClass.simpleName}: ${first.message}", first)
                stage = "configure-retry"
                try { codec.reset() } catch (_: Exception) {}
                try {
                    codec.configure(buildFormat(width, height, bitrate, fps, flexible), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                } catch (second: Exception) {
                    Log.w(TAG, "configure(flexible) failed: ${second.javaClass.simpleName}: ${second.message}", second)
                    stage = "configure-retry-semiplanar"
                    try { codec.reset() } catch (_: Exception) {}
                    codec.configure(buildFormat(width, height, bitrate, fps, semiPlanar), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                }
            }

            stage = "start"
            codec.start()

            isEncoding = true

            encodeThread = Thread {
                val bufferInfo = MediaCodec.BufferInfo()
                val codecRef = codec
                while (isEncoding) {
                    try {
                        val outputBufferId = codecRef.dequeueOutputBuffer(bufferInfo, 10000)
                        when {
                            outputBufferId >= 0 -> {
                                val outputBuffer = codecRef.getOutputBuffer(outputBufferId)
                                if (outputBuffer != null) {
                                    val encodedData = ByteArray(bufferInfo.size)
                                    outputBuffer.get(encodedData)
                                    val nalData = stripStartCode(encodedData)
                                    onEncodedFrame?.invoke(nalData)
                                    codecRef.releaseOutputBuffer(outputBufferId, false)
                                }
                            }
                            outputBufferId == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                                Log.d(TAG, "Output format changed: ${codecRef.outputFormat}")
                            }
                            outputBufferId == MediaCodec.INFO_TRY_AGAIN_LATER -> { /* no output yet */ }
                        }
                    } catch (e: Exception) {
                        if (isEncoding) Log.e(TAG, "encode loop error", e)
                        break
                    }
                }
            }
            encodeThread!!.start()

            promise.resolve(true)
        } catch (e: Exception) {
            isEncoding = false
            try { mediaCodec?.release() } catch (_: Exception) {}
            mediaCodec = null
            val detail = buildString {
                append(e.javaClass.name)
                val msg = e.message
                if (!msg.isNullOrEmpty()) append(": ").append(msg)
                if (e is MediaCodec.CodecException) append(" | ").append(e.diagnosticInfo)
            }
            Log.e(TAG, "initEncoder failed at stage=$stage (${width}x$height @ $bitrate bps, $fps fps): $detail", e)
            promise.reject("ENCODER_ERROR", "[$stage] $detail", e)
        }
    }

    /**
     * Encode a YUV_420_888 frame from CameraModule.
     * The input is planar YUV data: Y plane followed by U and V planes.
     */
    fun encodeFrame(yuvData: ByteArray) {
        if (!isEncoding || mediaCodec == null) return

        try {
            val inputBufferId = mediaCodec!!.dequeueInputBuffer(5000)
            if (inputBufferId >= 0) {
                val inputBuffer = mediaCodec!!.getInputBuffer(inputBufferId)
                if (inputBuffer != null) {
                    inputBuffer.clear()
                    inputBuffer.put(yuvData)
                    mediaCodec!!.queueInputBuffer(
                        inputBufferId,
                        0,
                        yuvData.size,
                        System.nanoTime() / 1000,
                        0
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to queue input frame", e)
        }
    }

    @ReactMethod
    fun releaseEncoder(promise: Promise) {
        try {
            releaseEncoderInternal()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("RELEASE_ENCODER_ERROR", e.message, e)
        }
    }

    private fun releaseEncoderInternal() {
        isEncoding = false
        encodeThread?.interrupt()
        encodeThread = null
        try { mediaCodec?.stop() } catch (_: Exception) {}
        try { mediaCodec?.release() } catch (_: Exception) {}
        mediaCodec = null
    }

    private fun stripStartCode(data: ByteArray): ByteArray {
        var start = 0
        if (data.size >= 4 && data[0] == 0.toByte() && data[1] == 0.toByte() && data[2] == 0.toByte() && data[3] == 1.toByte()) {
            start = 4
        } else if (data.size >= 3 && data[0] == 0.toByte() && data[1] == 0.toByte() && data[2] == 1.toByte()) {
            start = 3
        }
        return if (start > 0) data.copyOfRange(start, data.size) else data
    }

    override fun invalidate() {
        releaseEncoderInternal()
        super.invalidate()
    }

}
