//
//  OjowacamCameraModule.swift
//

import AVFoundation
import React

@objc(OjowacamCamera)
class OjowacamCameraModule: RCTEventEmitter {
    
    private var captureSession: AVCaptureSession?
    private var videoDeviceInput: AVCaptureDeviceInput?
    private var videoDataOutput: AVCaptureVideoDataOutput?
    private var videoDevice: AVCaptureDevice?
    private var isStreaming = false
    private var currentCameraPosition: AVCaptureDevice.Position = .back
    
    private var videoEncoder: OjowacamVideoEncoder?
    private var videoOutputQueue: DispatchQueue?
    
    override static func moduleName() -> String! {
        return "OjowacamCamera"
    }
    
    override func supportedEvents() -> [String]! {
        return ["onEncodedVideoFrame", "onCameraError", "onCameraStatusChanged"]
    }
    
    override func constantsToExport() -> [AnyHashable: Any]! {
        return [
            "initialCameraPosition": "back",
            "supportedResolutions": ["1280x720", "1920x1080", "3840x2160"],
            "supportedFrameRates": [30, 60]
        ]
    }
    
    override func startObserving() {}
    @objc
    func getAvailableCameras(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        var cameras: [[String: Any]] = []
        
        let discoverySession = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera],
            mediaType: .video,
            position: .unspecified
        )
        
        for device in discoverySession.devices {
            var facing = "unknown"
            if device.position == .back {
                facing = "back"
            } else if device.position == .front {
                facing = "front"
            }
            
            cameras.append([
                "id": device.uniqueID,
                "facing": facing,
                "name": device.localizedName
            ])
        }
        
        resolve(cameras)
    }
    
    @objc
    func startCapture(_ cameraId: String, width: NSNumber, height: NSNumber, fps: NSNumber, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard !isStreaming else {
            resolve(true)
            return
        }
        
        do {
            var selectedDevice: AVCaptureDevice?
            let discoverySession = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInWideAngleCamera],
                mediaType: .video,
                position: .unspecified
            )
            
            for device in discoverySession.devices where device.uniqueID == cameraId {
                selectedDevice = device
                break
            }
            
            guard let device = selectedDevice else {
                reject("CAMERA_NOT_FOUND", "Camera device not found", nil)
                return
            }
            
            try device.lockForConfiguration()
            
            var bestFormat: AVCaptureDevice.Format?
            for format in device.formats {
                let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
                if Int(dimensions.width) == width.intValue && Int(dimensions.height) == height.intValue {
                    bestFormat = format
                    break
                }
            }
            
            if let format = bestFormat {
                device.activeFormat = format
                device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: fps.int32Value)
                device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: fps.int32Value)
            }
            
            device.unlockForConfiguration()
            
            let session = AVCaptureSession()
            session.sessionPreset = .inputPriority
            
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) {
                session.addInput(input)
                self.videoDeviceInput = input
            }
            
            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
            output.alwaysDiscardsLateVideoFrames = true
            
            let queue = DispatchQueue(label: "com.ojowacam.videoQueue", qos: .userInteractive)
            output.setSampleBufferDelegate(self, queue: queue)
            
            if session.canAddOutput(output) {
                session.addOutput(output)
                self.videoDataOutput = output
            }
            
            self.videoDevice = device
            self.videoOutputQueue = queue
            self.captureSession = session
            self.currentCameraPosition = device.position
            
            self.videoEncoder = OjowacamVideoEncoder(
                width: width.intValue,
                height: height.intValue,
                bitrate: 8000000,
                fps: fps.intValue
            )
            self.videoEncoder?.onEncodedFrame = { [weak self] data in
                self?.sendEvent(withName: "onEncodedVideoFrame", body: [
                    "data": data.base64EncodedString(),
                    "timestamp": Date().timeIntervalSince1970 * 1000
                ])
            }
            
            session.startRunning()
            self.isStreaming = true
            
            sendEvent(withName: "onCameraStatusChanged", body: ["status": "streaming"])
            resolve(true)
            
        } catch {
            reject("CAMERA_ERROR", error.localizedDescription, error)
        }
    }
    
    @objc
    func stopCapture(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        captureSession?.stopRunning()
        captureSession = nil
        videoDeviceInput = nil
        videoDataOutput = nil
        videoDevice = nil
        videoEncoder = nil
        videoOutputQueue = nil
        isStreaming = false
        
        sendEvent(withName: "onCameraStatusChanged", body: ["status": "stopped"])
        resolve(true)
    }

    override func stopObserving() {}
}
    @objc
    func switchCamera(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard isStreaming, let session = captureSession else {
            resolve(currentCameraPosition == .back ? "front" : "back")
            return
        }
        
        session.stopRunning()
        currentCameraPosition = (currentCameraPosition == .back) ? .front : .back
        
        resolve(currentCameraPosition == .back ? "back" : "front")
    }
    
    @objc
    func setTorch(_ enabled: Bool, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let device = videoDevice, device.hasTorch else {
            resolve(false)
            return
        }
        
        do {
            try device.lockForConfiguration()
            device.torchMode = enabled ? .on : .off
            device.unlockForConfiguration()
            resolve(true)
        } catch {
            reject("TORCH_ERROR", error.localizedDescription, error)
        }
    }
    
    @objc
    func setZoom(_ zoomLevel: Float, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let device = videoDevice, device.format.videoMaxZoomFactor >= zoomLevel else {
            resolve(false)
            return
        }
        
        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = CGFloat(zoomLevel)
            device.unlockForConfiguration()
            resolve(true)
        } catch {
            reject("ZOOM_ERROR", error.localizedDescription, error)
        }
    }
    
    @objc
    func setFocusMode(_ mode: String, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let device = videoDevice else {
            resolve(false)
            return
        }
        
        do {
            try device.lockForConfiguration()
            
            switch mode {
            case "continuousAutoFocus":
                if device.isFocusModeSupported(.continuousAutoFocus) {
                    device.focusMode = .continuousAutoFocus
                }
            case "autoFocus":
                if device.isFocusModeSupported(.autoFocus) {
                    device.focusMode = .autoFocus
                }
            case "locked":
                device.focusMode = .locked
            default:
                break
            }
            
            device.unlockForConfiguration()
            resolve(true)
        } catch {
            reject("FOCUS_ERROR", error.localizedDescription, error)
        }
    }
}

