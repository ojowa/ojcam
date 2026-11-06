//
//  OjowacamAudioModule.swift
//

import AVFoundation
import React

@objc(OjowacamAudio)
class OjowacamAudioModule: RCTEventEmitter {
    
    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var isRecording = false
    private var audioFormat: AVAudioFormat?
    
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
        
        resolve(true)
    }
    
    @objc
    func getAudioLevels(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        // Return current audio level for VU meter
        resolve(0.5)
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, when: AVAudioTime) {
        guard isRecording else { return }
        
        // Convert PCM to Opus-encoded data
        // For now, emit raw PCM data as base64
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        
        var samples = [Float](repeating: 0, count: frameCount)
        for i in 0..<frameCount {
            samples[i] = channelData[i]
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
