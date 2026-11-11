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

    @ReactMethod
    fun initEncoder(width: Int, height: Int, bitrate: Int, fps: Int, promise: Promise) {
        try {
            releaseEncoderInternal()
            this.width = width
            this.height = height

            val format = MediaFormat.createVideoFormat("video/avc", width, height)
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            format.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            format.setInteger(MediaFormat.KEY_LEVEL, 51)
            format.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh)

            mediaCodec = MediaCodec.createEncoderByType("video/avc")
            mediaCodec!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            mediaCodec!!.start()

            isEncoding = true

            encodeThread = Thread {
                val bufferInfo = MediaCodec.BufferInfo()
                while (isEncoding) {
                    val outputBufferId = mediaCodec!!.dequeueOutputBuffer(bufferInfo, 10000)
                    when {
                        outputBufferId >= 0 -> {
                            val outputBuffer = mediaCodec!!.getOutputBuffer(outputBufferId)
                            if (outputBuffer != null) {
                                val encodedData = ByteArray(bufferInfo.size)
                                outputBuffer.get(encodedData)
                                val nalData = stripStartCode(encodedData)
                                onEncodedFrame?.invoke(nalData)
                                mediaCodec!!.releaseOutputBuffer(outputBufferId, false)
                            }
                        }
                        outputBufferId == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val newFormat = mediaCodec!!.outputFormat
                            Log.d(TAG, "Output format changed: $newFormat")
                        }
                        outputBufferId == MediaCodec.INFO_TRY_AGAIN_LATER -> Log.d(TAG, "No output buffer available")
                    }
                }
            }
            encodeThread!!.start()

            promise.resolve(true)
        } catch (e: Exception) {
            isEncoding = false
            promise.reject("ENCODER_ERROR", e.message, e)
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
        mediaCodec?.stop()
        mediaCodec?.release()
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
