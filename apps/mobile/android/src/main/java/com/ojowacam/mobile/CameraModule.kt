package com.ojowacam.mobile

import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.media.ImageReader
import android.util.Log
import android.view.Surface
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import java.util.concurrent.TimeUnit

class CameraModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OjowacamCamera"
    private val cameraManager: CameraManager
    private var currentCameraId: String? = null
    private var isStreaming = false

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null

    var onEncodedFrame: ((ByteArray) -> Unit)? = null
    var onVideoFrame: ((ByteArray, Long) -> Unit)? = null

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
            stopCaptureInternal()
            currentCameraId = cameraId
            isStreaming = true
            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            imageReader = ImageReader.newInstance(width, height, android.graphics.ImageFormat.YUV_420_888, 5)
            val stateCallback = object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    createCaptureSession(device, width, height, fps)
                }
                override fun onDisconnected(device: CameraDevice) {
                    device.close(); cameraDevice = null; isStreaming = false
                }
                override fun onError(device: CameraDevice, error: Int) {
                    device.close(); cameraDevice = null; isStreaming = false
                    promise.reject("CAMERA_ERROR", "Camera error: $error", null)
                }
            }
            val handler = android.os.Handler(android.os.HandlerThread("CameraOpenThread").apply { start() }.looper)
            cameraManager.openCamera(cameraId, stateCallback, handler)
            promise.resolve(true)
        } catch (e: Exception) {
            isStreaming = false
            promise.reject("CAPTURE_ERROR", e.message, e)
        }
    }
    private fun createCaptureSession(device: CameraDevice, width: Int, height: Int, fps: Int) {
        try {
            val surface = imageReader!!.surface
            val listener = object : ImageReader.OnImageAvailableListener {
                override fun onImageAvailable(reader: ImageReader) {
                    reader.acquireNextImage()?.use { image ->
                        val planes = image.planes
                        if (planes.size >= 3) {
                            val yBuffer = planes[0].buffer
                            val uBuffer = planes[1].buffer
                            val vBuffer = planes[2].buffer
                            val ySize = yBuffer.remaining()
                            val uSize = uBuffer.remaining()
                            val vSize = vBuffer.remaining()
                            val totalSize = ySize + uSize + vSize
                            val yuvData = ByteArray(totalSize)
                            yBuffer.get(yuvData, 0, ySize)
                            uBuffer.get(yuvData, ySize, uSize)
                            vBuffer.get(yuvData, ySize + uSize, vSize)
                            onEncodedFrame?.invoke(yuvData)
                            val timestamp = System.currentTimeMillis()
                            onVideoFrame?.invoke(yuvData, timestamp)
                        }
                        image.close()
                    }
                }
            }
            imageReader!!.setOnImageAvailableListener(listener, android.os.Handler(android.os.HandlerThread("ImageReaderThread").apply { start() }.looper))
            val stateCallback = object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    captureSession = session
                    Log.d(TAG, "Camera capture session configured")
                }
                override fun onConfigureFailed(session: CameraCaptureSession) {
                    Log.e(TAG, "Camera capture session configuration failed")
                    isStreaming = false
                }
            }
            device.createCaptureSession(listOf(surface), stateCallback, android.os.Handler(android.os.HandlerThread("CaptureSessionThread").apply { start() }.looper))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create capture session", e)
            isStreaming = false
        }
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        try {
            stopCaptureInternal()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    private fun stopCaptureInternal() {
        isStreaming = false
        captureSession?.stopRepeating()
        captureSession?.close()
        captureSession = null
        cameraDevice?.close()
        cameraDevice = null
        imageReader?.close()
        imageReader = null
    }

    @ReactMethod
    fun switchCamera(promise: Promise) {
        try {
            val cameraIds = cameraManager.getCameraIdList()
            val current = currentCameraId ?: "0"
            val newId = if (current == cameraIds[0] && cameraIds.size > 1) cameraIds[1] else cameraIds[0]
            stopCaptureInternal()
            currentCameraId = newId
            val characteristics = cameraManager.getCameraCharacteristics(newId)
            imageReader = ImageReader.newInstance(1920, 1080, android.graphics.ImageFormat.YUV_420_888, 5)
            val stateCallback = object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    createCaptureSession(device, 1920, 1080, 30)
                }
                override fun onDisconnected(device: CameraDevice) {
                    device.close(); cameraDevice = null
                }
                override fun onError(device: CameraDevice, error: Int) {
                    device.close(); cameraDevice = null
                }
            }
            val handler = android.os.Handler(android.os.HandlerThread("CameraSwitchThread").apply { start() }.looper)
            cameraManager.openCamera(newId, stateCallback, handler)
            promise.resolve(newId)
        } catch (e: Exception) {
            promise.reject("SWITCH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setTorch(enabled: Boolean, promise: Promise) {
        try {
            val id = currentCameraId
            if (id == null) { promise.resolve(false); return }
            val characteristics = cameraManager.getCameraCharacteristics(id)
            val hasTorch = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            if (!hasTorch) { promise.resolve(false); return }
            cameraManager.setTorchMode(id, enabled)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("TORCH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setZoom(zoomLevel: Float, promise: Promise) {
        try {
            val id = currentCameraId
            if (id == null || captureSession == null) { promise.resolve(false); return }
            val characteristics = cameraManager.getCameraCharacteristics(id)
            val maxZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1.0f
            val clampedZoom = zoomLevel.coerceIn(1.0f, maxZoom)
            val builder = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
            builder.addTarget(imageReader!!.surface)
            builder.set(CaptureRequest.SCALER_CROP_REGION, calculateCropRegion(characteristics, clampedZoom))
            builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            captureSession!!.capture(builder.build(), null, null)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ZOOM_ERROR", e.message, e)
        }
    }

    private fun calculateCropRegion(characteristics: CameraCharacteristics, zoom: Float): android.graphics.Rect {
        val sensorSize = characteristics.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE) ?: return android.graphics.Rect(0, 0, 1000, 1000)
        val cropWidth = (sensorSize.width / zoom).toInt()
        val cropHeight = (sensorSize.height / zoom).toInt()
        val left = (sensorSize.width - cropWidth) / 2
        val top = (sensorSize.height - cropHeight) / 2
        return android.graphics.Rect(left, top, left + cropWidth, top + cropHeight)
    }

    @ReactMethod
    fun setFocusMode(mode: String, promise: Promise) {
        try {
            val id = currentCameraId
            if (id == null) { promise.resolve(false); return }
            val characteristics = cameraManager.getCameraCharacteristics(id)
            val builder = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
            builder.addTarget(imageReader!!.surface)
            when (mode) {
                "continuousAutoFocus" -> {
                    if (characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)!!.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
                        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                    }
                }
                "autoFocus" -> {
                    if (characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)!!.contains(CaptureRequest.CONTROL_AF_MODE_AUTO)) {
                        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_AUTO)
                    }
                }
                "locked" -> builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
            }
            builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            captureSession?.capture(builder.build(), null, null)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("FOCUS_ERROR", e.message, e)
        }
    }

    fun isStreaming(): Boolean = isStreaming
    fun getCurrentCameraId(): String? = currentCameraId

}

