package com.ojowacam.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class OjowacamPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): MutableList<NativeModule> {
        val camera = CameraModule(reactContext)
        val audio = AudioModule(reactContext)
        val encoder = EncoderModule(reactContext)
        val webrtc = WebRTCModule(reactContext)
        val usb = USBModule(reactContext)

        // Camera YUV frames → WebRTC video track (WebRTC encodes).
        // onVideoFrame payload is (i420, timestampNs).
        camera.onVideoFrame = { i420, timestampNs ->
            val w = camera.frameWidth
            val h = camera.frameHeight
            if (w > 0 && h > 0) {
                webrtc.deliverVideoFrame(i420, timestampNs, w, h)
            }
        }

        // Camera YUV frames → external MediaCodec encoder.
        camera.onEncodedFrame = { i420 -> encoder.encodeFrame(i420) }

        return mutableListOf(camera, audio, encoder, webrtc, usb)
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): MutableList<ViewManager<*, *>> {
        return mutableListOf()
    }

}
