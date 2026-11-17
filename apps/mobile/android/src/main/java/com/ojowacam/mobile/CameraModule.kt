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
    private val permissions = AndroidPermissions(reactContext)
    private var currentCameraId: String? = null
    private var isStreaming = false

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null

    var onEncodedFrame: ((ByteArray) -> Unit)? = null
    var onVideoFrame: ((ByteArray, Long) -> Unit)? = null

    /** Frame dimensions from the active capture session; used by pipeline consumers. */
    var frameWidth: Int = 0
        private set
    var frameHeight: Int = 0
        private set

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
        permissions.ensureCamera(promise) {
            startCaptureInternal(cameraId, width, height, fps, promise)
        }
    }

    private fun startCaptureInternal(cameraId: String, width: Int, height: Int, fps: Int, promise: Promise) {
        try {
            Log.d(TAG, "startCaptureInternal: cameraId=$cameraId width=$width height=$height fps=$fps")
            stopCaptureInternal()
            currentCameraId = cameraId
            isStreaming = true

            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            val outputMap = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)

            // Try multiple formats: YUV_420_888 first, then JPEG as fallback
            val targetFormats = listOf(
                android.graphics.ImageFormat.YUV_420_888,
                android.graphics.ImageFormat.JPEG
            )

            var chosenSize: android.util.Size? = null
            var chosenFormat = android.graphics.ImageFormat.YUV_420_888

            for (fmt in targetFormats) {
                val sizes = outputMap?.getOutputSizes(fmt) ?: emptyArray()
                if (sizes.isEmpty()) continue
                val chosen = chooseOutputSize(sizes, width, height)
                chosenSize = chosen
                chosenFormat = fmt
                break
            }

            if (chosenSize == null) {
                promise.reject("CAMERA_FORMAT_ERROR", "Camera does not support any output format")
                return
            }

            frameWidth = chosenSize.width
            frameHeight = chosenSize.height
            imageReader = ImageReader.newInstance(chosenSize.width, chosenSize.height, chosenFormat, 5)

            val stateCallback = object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    Log.d(TAG, "camera opened: $cameraId")
                    cameraDevice = device
                    createCaptureSession(device, chosenSize.width, chosenSize.height, fps, chosenFormat)
                }
                override fun onDisconnected(device: CameraDevice) {
                    Log.d(TAG, "camera disconnected: $cameraId")
                    device.close(); cameraDevice = null; isStreaming = false
                }
                override fun onError(device: CameraDevice, error: Int) {
                    Log.e(TAG, "camera error: $cameraId error=$error")
                    device.close(); cameraDevice = null; isStreaming = false
                    promise.reject("CAMERA_ERROR", "Camera error: $error", null)
                }
            }
            val handler = android.os.Handler(android.os.HandlerThread("CameraOpenThread").apply { start() }.looper)
            cameraManager.openCamera(cameraId, stateCallback, handler)
            val result = Arguments.createMap().apply {
                putInt("width", chosenSize.width)
                putInt("height", chosenSize.height)
            }
            promise.resolve(result)
        } catch (e: SecurityException) {
            isStreaming = false
            promise.reject("E_CAMERA_PERMISSION", "Camera permission not granted", e)
        } catch (e: Exception) {
            isStreaming = false
            promise.reject("CAPTURE_ERROR", e.message, e)
        }
    }

    private fun chooseOutputSize(sizes: Array<android.util.Size>, reqW: Int, reqH: Int): android.util.Size {
        if (sizes.isEmpty()) return android.util.Size(reqW, reqH)
        sizes.firstOrNull { it.width == reqW && it.height == reqH }?.let { return it }
        val reqAspect = reqW.toFloat() / reqH.toFloat()
        fun aspect(size: android.util.Size): Float = size.width.toFloat() / size.height.toFloat()
        val sameAspect = sizes.filter { kotlin.math.abs(aspect(it) - reqAspect) < 0.05f }
        val pool = if (sameAspect.isNotEmpty()) sameAspect else sizes.toList()
        val reqArea = reqW.toLong() * reqH
        val noUpscale = pool.filter { it.width.toLong() * it.height <= reqArea }
        if (noUpscale.isNotEmpty()) {
            return noUpscale.maxByOrNull { it.width.toLong() * it.height }!!
        }
        return pool.minByOrNull { it.width.toLong() * it.height }!!
    }
    private fun createCaptureSession(device: CameraDevice, width: Int, height: Int, fps: Int, format: Int) {
        try {
            val surface = imageReader!!.surface
            val listener = object : ImageReader.OnImageAvailableListener {
                var frameCount = 0L
                override fun onImageAvailable(reader: ImageReader) {
                    reader.acquireNextImage()?.use { image ->
                        val yuvData = convertImageToI420(image)
                        if (yuvData != null) {
                            val timestampNs = System.nanoTime()
                            frameCount++
                            if (frameCount <= 5L || frameCount % 30L == 0L) {
                                Log.d(TAG, "onImageAvailable #$frameCount ${image.width}x${image.height} fmt=${image.format} ts=$timestampNs")
                            }
                            onVideoFrame?.invoke(yuvData, timestampNs)
                            onEncodedFrame?.invoke(yuvData)
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
                    try {
                        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
                        builder.addTarget(imageReader!!.surface)
                        builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                        captureSession!!.setRepeatingRequest(builder.build(), null, null)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to start repeating capture request", e)
                        isStreaming = false
                    }
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
        frameWidth = 0
        frameHeight = 0
        captureSession?.stopRepeating()
        captureSession?.close()
        captureSession = null
        cameraDevice?.close()
        cameraDevice = null
        imageReader?.close()
        imageReader = null
    }

    /**
     * Convert YUV image to tightly packed I420:
     * Y plane (w*h), then U (w/2 * h/2), then V (w/2 * h/2).
     * Handles YUV_420_888 format. Returns null on any error.
     */
    private fun convertImageToI420(image: android.media.Image): ByteArray? {
        val format = image.format
        if (format != android.graphics.ImageFormat.YUV_420_888) {
            Log.w(TAG, "Image format $format not supported for I420 conversion, expected YUV_420_888")
            return null
        }

        val width = image.width
        val height = image.height
        if (width <= 0 || height <= 0 || image.planes.size < 3) return null

        val ySize = width * height
        val chromaWidth = width / 2
        val chromaHeight = height / 2
        val chromaSize = chromaWidth * chromaHeight
        val out = ByteArray(ySize + chromaSize * 2)

        try {
            val yPlane = image.planes[0]
            val uPlane = image.planes[1]
            val vPlane = image.planes[2]

            copyPlane(yPlane.buffer, yPlane.rowStride, yPlane.pixelStride, width, height, out, 0, ySize, width)
            copyPlane(uPlane.buffer, uPlane.rowStride, uPlane.pixelStride, chromaWidth, chromaHeight, out, ySize, chromaSize, chromaWidth)
            copyPlane(vPlane.buffer, vPlane.rowStride, vPlane.pixelStride, chromaWidth, chromaHeight, out, ySize + chromaSize, chromaSize, chromaWidth)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to convert I420 frame: ${e.message}", e)
            return null
        }

        return out
    }

    private fun copyPlane(
        src: java.nio.ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
        dst: ByteArray,
        dstOffset: Int,
        dstSize: Int,
        dstRowStride: Int,
    ) {
        src.rewind()
        val dstRemaining = dst.size - dstOffset
        if (dstRemaining <= 0) return

        if (pixelStride == 1 && rowStride == width) {
            val toCopy = minOf(src.remaining(), dstRemaining)
            if (toCopy > 0) {
                src.get(dst, dstOffset, toCopy)
            }
            return
        }
        var outPos = dstOffset
        for (row in 0 until height) {
            val srcPos = row * rowStride
            if (srcPos >= src.limit()) break
            if (pixelStride == 1) {
                val rowRemaining = dstRemaining - outPos
                if (rowRemaining <= 0) break
                val copyWidth = minOf(width, rowRemaining)
                for (col in 0 until copyWidth) {
                    val srcIdx = srcPos + col
                    if (srcIdx >= src.limit()) break
                    dst[outPos + col] = src.get(srcPos + col)
                }
                outPos += copyWidth
            } else {
                for (col in 0 until width) {
                    val idx = srcPos + col * pixelStride
                    val dstIdx = outPos + col
                    if (idx >= src.limit()) break
                    if (dstIdx >= dst.size) break
                    dst[dstIdx] = src.get(idx)
                }
                outPos += width
            }
        }
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
                    createCaptureSession(device, 1920, 1080, 30, android.graphics.ImageFormat.YUV_420_888)
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
            if (id == null || captureSession == null || cameraDevice == null || imageReader == null) {
                promise.resolve(false)
                return
            }
            val characteristics = cameraManager.getCameraCharacteristics(id)
            val maxZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1.0f
            val actualMaxZoom = Math.max(maxZoom, 4.0f)
            val clampedZoom = zoomLevel.coerceIn(1.0f, actualMaxZoom)
            val builder = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
            builder.addTarget(imageReader!!.surface)
            builder.set(CaptureRequest.SCALER_CROP_REGION, calculateCropRegion(characteristics, clampedZoom))
            builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            captureSession!!.setRepeatingRequest(builder.build(), null, null)
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