package com.ojowacam.mobile

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.ojowacam.mobile.usb.USBService

class USBModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OjowacamUSB"
    private var isInitialized = false

    override fun getName(): String = "OjowacamUSB"

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            if (isInitialized) { promise.resolve(true); return }
            // Send broadcast to start USB service
            val intent = Intent(reactApplicationContext, USBService::class.java)
            intent.action = "com.ojowacam.action.START_USB"
            intent.putExtra("device_id", "")
            intent.putExtra("local_port", 8080)
            intent.putExtra("remote_port", 8081)
            reactApplicationContext.startService(intent)
            isInitialized = true
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("USB_INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun startUSB(deviceId: String, localPort: Int, remotePort: Int, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, USBService::class.java)
            intent.action = "com.ojowacam.action.START_USB"
            intent.putExtra("device_id", deviceId)
            intent.putExtra("local_port", localPort)
            intent.putExtra("remote_port", remotePort)
            reactApplicationContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("USB_START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopUSB(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, USBService::class.java)
            intent.action = "com.ojowacam.action.STOP_USB"
            reactApplicationContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("USB_STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getUSBDevices(promise: Promise) {
        try {
            // Return empty list - USB device discovery would require
            // USB host mode enumeration
            promise.resolve(Arguments.createArray())
        } catch (e: Exception) {
            promise.reject("USB_DEVICES_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun sendCommand(data: Array<Int>, promise: Promise) {
        try {
            val byteArray = data.map { it.toByte() }.toTypedArray()
            // Send via USB service
            val usbService = reactApplicationContext.getSystemService(
                android.content.Context.USB_SERVICE
            )
            Log.d(TAG, "Sending USB command: ${byteArray.size} bytes")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("USB_SEND_ERROR", e.message, e)
        }
    }

    override fun invalidate() {
        super.invalidate()
    }

}
