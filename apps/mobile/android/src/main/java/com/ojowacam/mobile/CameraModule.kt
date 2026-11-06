package com.ojowacam.mobile

import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class CameraModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val TAG = "OjowacamCamera"
    private val cameraManager: CameraManager
    private var currentCameraId = "0"
    private var isStreaming = false

    init {
        cameraManager = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    }

    override fun getName(): String = "OjowacamCamera"

    @ReactMethod
    fun getAvailableCameras(promise: Promise) {
        try {
            val cameraIds = cameraManager.getCameraIdList()
            val cameras = Arguments.createArray()

            for (id in cameraIds) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val facing = characteristics.get(CameraCharacteristics.LENS_FACING)

                val camera = Arguments.createMap()
                camera.putString("id", id)
                camera.putString("facing", if (facing == CameraCharacteristics.LENS_FACING_BACK) "back" else "front")
                cameras.pushMap(camera)
            }

            promise.resolve(cameras)
        } catch (e: CameraAccessException) {
            promise.reject("CAMERA_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun startCapture(cameraId: String, width: Int, height: Int, fps: Int, promise: Promise) {
        try {
            currentCameraId = cameraId
            isStreaming = true
            Log.d(TAG, "Starting capture: $cameraId ${width}x$height @$fps fps")
            promise.resolve(true)
        } catch (e: Exception) {
            isStreaming = false
            promise.reject("CAPTURE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        try {
            isStreaming = false
            Log.d(TAG, "Stopping capture")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun switchCamera(promise: Promise) {
        try {
            val cameraIds = cameraManager.getCameraIdList()
            val newId = if (currentCameraId == "0" && cameraIds.size > 1) cameraIds[1] else cameraIds[0]
            currentCameraId = newId
            promise.resolve(newId)
        } catch (e: Exception) {
            promise.reject("SWITCH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setTorch(enabled: Boolean, promise: Promise) {
        try {
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("TORCH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setZoom(zoomLevel: Float, promise: Promise) {
        try {
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ZOOM_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setFocusMode(mode: String, promise: Promise) {
        try {
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("FOCUS_ERROR", e.message, e)
        }
    }

    fun isStreaming(): Boolean = isStreaming
    fun getCurrentCameraId(): String = currentCameraId
}

