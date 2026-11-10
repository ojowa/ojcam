package com.ojowacam.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.bridge.JavaScriptModule
import com.ojowacam.mobile.usb.USBModule
import java.util.Collections
import java.util.List

class OjowacamPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            CameraModule(reactContext),
            AudioModule(reactContext),
            EncoderModule(reactContext),
            WebRTCModule(reactContext),
            USBModule(reactContext)
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return Collections.emptyList()
    }

}
