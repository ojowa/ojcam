//
//  StreamReceiverService+Extensions.swift
//  Ojowacam Desktop
//

import Foundation
import WebRTC
import CoreMedia
import VideoToolbox

extension StreamReceiverService: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate, url: String?) {}
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        for videoTrack in stream.videoTracks {
            self.videoTrack = videoTrack
            videoTrack.add(self)
        }
        for audioTrack in stream.audioTracks {
            self.audioTrack = audioTrack
        }
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange state: RTCIceConnectionState) {
        let connected = state == .connected || state == .completed
        notifyConnectionStatus(ConnectionStatus(
            isConnected: connected,
            statusString: state.rawValue,
            latencyMs: 0,
            bitrateMbps: 0,
            frameRate: 0
        ))
    }
}

extension StreamReceiverService: RTCVideoTrackDelegate {
    func videoTrack(_ videoTrack: RTCVideoTrack, didChange isEnabled: Bool) {}
}

extension StreamReceiverService: RTCVideoRenderer {
    func setSize(_ size: CGSize) {}
    
    func renderFrame(_ frame: RTCVideoFrame) {
        let pixelBuffer = (frame.buffer as? RTCCVPixelBuffer)?.pixelBuffer
        guard let buffer = pixelBuffer else { return }
        
        let ciImage = CIImage(cvPixelBuffer: buffer)
        let context = CIContext()
        if let cgImage = context.createCGImage(ciImage, from: ciImage.extent) {
            let nsImage = NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
            onVideoFrame?(nsImage)
        }
    }
}

enum StreamError: Error {
    case webRTCNotInitialized
    case connectionFailed
}

struct StreamConfig {
    let resolution: String
    let frameRate: Int
    let bitrate: Int
    let videoCodec: String
    let audioCodec: String
    let sampleRate: Int
    let channels: Int
}

struct ConnectionStatus {
    let isConnected: Bool
    let statusString: String
    let latencyMs: Int
    let bitrateMbps: Double
    let frameRate: Int
}

class H264VideoDecoder {
    private var decompressionSession: VTDecompressionSession?
    var onFrameDecoded: ((NSImage) -> Void)?
    
    func initialize(width: Int, height: Int) async {
        var formatDescription: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            codecType: kCMVideoCodecType_H264,
            width: Int32(width),
            height: Int32(height),
            extensions: nil,
            formatDescriptionOut: &formatDescription
        )
        
        guard let formatDesc = formatDescription else { return }
        
        var decompressionSession: VTDecompressionSession?
        let status = VTDecompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            formatDescription: formatDesc,
            callback: { (refcon, statusFlags, status, info, imageBuffer, presentationTime, duration) in
                guard let refcon = refcon,
                      let imageBuffer = imageBuffer,
                      status == noErr else { return }
                
                let decoder = Unmanaged<H264VideoDecoder>.fromOpaque(refcon).takeUnretainedValue()
                
                let ciImage = CIImage(cvPixelBuffer: imageBuffer)
                let context = CIContext()
                if let cgImage = context.createCGImage(ciImage, from: ciImage.extent) {
                    let nsImage = NSImage(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
                    
                    DispatchQueue.main.async {
                        decoder.onFrameDecoded?(nsImage)
                    }
                }
            },
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            decompressionSessionOut: &decompressionSession
        )
        
        self.decompressionSession = decompressionSession
    }
}

class CoreAudioRenderer {
    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    
    func initialize(sampleRate: Int, channels: Int) async {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        
        let format = AVAudioFormat(
            standardFormatWithSampleRate: Double(sampleRate),
            channels: AVAudioChannelCount(channels)
        )
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, when in
            // Audio routed to system output via AVAudioEngine
        }
        
        engine.prepare()
        try? engine.start()
        
        self.audioEngine = engine
        self.inputNode = inputNode
    }
    
    func stop() {
        audioEngine?.stop()
        inputNode?.removeTap(onBus: 0)
    }
}
