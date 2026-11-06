package com.ojowacam.mobile

import android.media.MediaCodec
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

    // Callback for encoded H264 NAL units
    var onEncodedFrame: ((ByteArray) -> Unit)? = null

    override fun getName(): String = "OjowacamEncoder"

    @ReactMethod
    fun initEncoder(width: Int, height: Int, bitrate: Int, fps: Int, promise: Promise) {
        try {
            val format = MediaFormat.createVideoFormat("video/avc", width, height)
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, 0x7FA30C01) // COLOR_FormatSurface
            format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            format.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            format.setInteger(MediaFormat.KEY_LEVEL, 51) // Level 5.1 for 4K
            format.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh)

            mediaCodec = MediaCodec.createEncoderByType("video/avc")
            mediaCodec!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            mediaCodec!!.start()

            isEncoding = true

            encodeThread = Thread {
                val bufferInfo = MediaCodec.BufferInfo()
                while (isEncoding) {
                    val outputBufferId = mediaCodec!!.dequeueOutputBuffer(bufferInfo, 10000)
                    if (outputBufferId >= 0) {
                        val outputBuffer = mediaCodec!!.getOutputBuffer(outputBufferId)
                        if (outputBuffer != null) {
                            val encodedData = ByteArray(bufferInfo.size)
                            outputBuffer.get(encodedData)
                            onEncodedFrame?.invoke(encodedData)
                            mediaCodec!!.releaseOutputBuffer(outputBufferId, false)
                        }
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

    @ReactMethod
    fun releaseEncoder(promise: Promise) {
        try {
            isEncoding = false
            encodeThread?.interrupt()
            encodeThread = null
            mediaCodec?.stop()
            mediaCodec?.release()
            mediaCodec = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("RELEASE_ENCODER_ERROR", e.message, e)
        }
    }

    fun queueInputFrame(surface: android.view.Surface, presentationTimeUs: Long) {
        // TODO: Bind Surface to Camera2 output, queue frame for encoding
    }

    override fun onDestroy() {
        releaseEncoder(com.facebook.react.bridge.Promise() { _, _ -> })
        super.onDestroy()
    }
}
