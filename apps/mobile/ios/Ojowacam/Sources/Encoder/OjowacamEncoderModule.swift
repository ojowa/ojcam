//
//  OjowacamEncoderModule.swift
//  Ojowacam
//

import React

@objc(OjowacamEncoder)
class OjowacamEncoderModule: RCTEventEmitter {

    private var videoEncoder: OjowacamVideoEncoder?
    private var isInitialized = false

    override static func moduleName() -> String! {
        return "OjowacamEncoder"
    }

    override func supportedEvents() -> [String]! {
        return ["onEncodedFrame", "onEncoderError", "onEncoderStatusChanged"]
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        return [:]
    }

    override func startObserving() {}
    override func stopObserving() {}

    @objc
    func initEncoder(_ width: NSNumber, height: NSNumber, bitrate: NSNumber, fps: NSNumber, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard !isInitialized else {
            resolve(true)
            return
        }

        do {
            let encoder = OjowacamVideoEncoder(
                width: width.intValue,
                height: height.intValue,
                bitrate: bitrate.intValue,
                fps: fps.intValue
            )
            encoder.onEncodedFrame = { [weak self] data in
                self?.sendEvent(withName: "onEncodedFrame", body: [
                    "data": data.base64EncodedString(),
                    "timestamp": Date().timeIntervalSince1970 * 1000
                ])
            }
            self.videoEncoder = encoder
            self.isInitialized = true

            sendEvent(withName: "onEncoderStatusChanged", body: ["status": "initialized"])
            resolve(true)
        } catch {
            reject("ENCODER_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func releaseEncoder(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard isInitialized else {
            resolve(true)
            return
        }

        self.videoEncoder = nil
        self.isInitialized = false

        sendEvent(withName: "onEncoderStatusChanged", body: ["status": "released"])
        resolve(true)
    }

    func encodeFrame(_ sampleBuffer: Any) {
        guard isInitialized, let encoder = videoEncoder else { return }
        // This method is called internally by the camera module
        // The OjowacamVideoEncoder handles CMSampleBuffer directly
    }
}
