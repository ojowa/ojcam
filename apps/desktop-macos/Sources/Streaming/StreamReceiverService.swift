//
//  StreamReceiverService.swift
//  Ojowacam Desktop
//

import Foundation
import WebRTC
import CoreMedia
import VideoToolbox

class StreamReceiverService {
    private var peerConnectionFactory: PeerConnectionFactory?
    private var peerConnection: RTCPeerConnection?
    private var videoTrack: RTCVideoTrack?
    private var audioTrack: RTCAudioTrack?
    
    private var videoDecoder: H264VideoDecoder?
    private var audioRenderer: CoreAudioRenderer?
    
    var onDeviceDiscovered: ((DeviceInfo) -> Void)?
    var onConnectionStatusChanged: ((ConnectionStatus) -> Void)?
    var onVideoFrame: ((NSImage) -> Void)?
    
    private var isStreaming = false
    private var currentDevice: DeviceInfo?
    
    func setStreamConfig(_ config: StreamConfig) async {
        videoDecoder = H264VideoDecoder()
        audioRenderer = CoreAudioRenderer()
        await audioRenderer?.initialize(sampleRate: config.sampleRate, channels: config.channels)
        
        PeerConnectionFactory.initialize(
            encoderFactory: DefaultVideoEncoderFactory(),
            decoderFactory: DefaultVideoDecoderFactory()
        )
        peerConnectionFactory = PeerConnectionFactory(options: PeerConnectionFactory.Options())
    }
    
    func connect(to device: DeviceInfo) async throws {
        currentDevice = device
        
        guard let factory = peerConnectionFactory else {
            throw StreamError.webRTCNotInitialized
        }
        
        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        
        peerConnection = factory.peerConnection(
            with: config,
            constraints: RTCMediaConstraints(
                mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "false"],
                optionalConstraints: nil
            ),
            delegate: self
        )
        
        isStreaming = true
        notifyConnectionStatus(ConnectionStatus(
            isConnected: true,
            statusString: "Connected",
            latencyMs: 0,
            bitrateMbps: 0,
            frameRate: 0
        ))
    }
    
    func disconnect() async {
        isStreaming = false
        peerConnection?.close()
        peerConnection = nil
        videoTrack = nil
        audioTrack = nil
        
        notifyConnectionStatus(ConnectionStatus(
            isConnected: false,
            statusString: "Disconnected",
            latencyMs: 0,
            bitrateMbps: 0,
            frameRate: 0
        ))
    }
    
    private func notifyConnectionStatus(_ status: ConnectionStatus) {
        onConnectionStatusChanged?(status)
    }
}
