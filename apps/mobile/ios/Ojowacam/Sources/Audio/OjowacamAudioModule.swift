//
//  OjowacamAudioModule.swift
//  Ojowacam
//

import AVFoundation
import React

@objc(OjowacamAudio)
class OjowacamAudioModule: RCTEventEmitter {

    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var isRecording = false
    private var audioFormat: AVAudioFormat?

    /// RMS of the captured signal normalized to full-scale sine RMS (0.7071),
    /// updated from the tap and reported by getAudioLevels().
    private var lastLevel: Float = 0.0

    override static func moduleName() -> String! {
        return "OjowacamAudio"
    }

    override func supportedEvents() -> [String]! {
        return ["onEncodedAudioFrame", "onAudioError", "onAudioLevels"]
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        return [
            "sampleRate": 48000,
            "channels": 2
        ]
    }

    override func startObserving() {}
    override func stopObserving() {}

    @objc
    func startRecording(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard !isRecording else {
            resolve(true)
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)

            let engine = AVAudioEngine()
            let inputNode = engine.inputNode

            let format = inputNode.outputFormat(forBus: 0)
            self.audioFormat = format

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, when in
                self?.processAudioBuffer(buffer, when: when)
            }

            engine.prepare()
            try engine.start()

            self.audioEngine = engine
            self.inputNode = inputNode
            self.isRecording = true

            resolve(true)
        } catch {
            reject("AUDIO_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func stopRecording(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard isRecording else {
            resolve(true)
            return
        }

        inputNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        inputNode = nil
        isRecording = false
        lastLevel = 0.0

        resolve(true)
    }

    @objc
    func getAudioLevels(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(isRecording ? Double(lastLevel) : 0.0)
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, when: AVAudioTime) {
        guard isRecording else { return }

        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        var samples = [Float](repeating: 0, count: frameCount)
        var sumSquares: Double = 0.0
        for i in 0..<frameCount {
            samples[i] = channelData[i]
            sumSquares += Double(channelData[i]) * Double(channelData[i])
        }
        if frameCount > 0 {
            let rms = sqrt(sumSquares / Double(frameCount))
            // Normalize against full-scale sine RMS (~0.7071) for a 0..1 meter.
            let normalized = Float(min(1.0, max(0.0, rms / 0.7071)))
            DispatchQueue.main.async {
                self.lastLevel = normalized
            }
        }

        let data = Data(buffer: UnsafeBufferPointer(start: samples, count: frameCount))

        DispatchQueue.main.async {
            self.sendEvent(withName: "onEncodedAudioFrame", body: [
                "data": data.base64EncodedString(),
                "timestamp": Date().timeIntervalSince1970 * 1000,
                "sampleRate": self.audioFormat?.sampleRate ?? 48000,
                "channels": self.audioFormat?.channelCount ?? 2
            ])
        }
    }
}
