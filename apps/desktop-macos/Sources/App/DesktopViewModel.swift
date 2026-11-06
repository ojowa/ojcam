//
//  DesktopViewModel.swift
//  Ojowacam Desktop
//

import Foundation
import Combine

class DesktopViewModel: ObservableObject {
    @Published var devices: [DeviceInfo] = []
    @Published var selectedDevice: DeviceInfo?
    @Published var isConnected = false
    @Published var status = "Disconnected"
    @Published var selectedQuality = "1080p"
    @Published var latencyMs = 0
    @Published var bitrateMbps = 0.0
    @Published var frameRate = 0
    @Published var torchOn = false
    @Published var videoFrame: NSImage?
    
    private let streamService = StreamReceiverService()
    private var cancellables = Set<AnyCancellable>()
    
    var canConnect: Bool {
        selectedDevice != nil && !isConnected
    }
    
    func initialize() async {
        let config = StreamConfig(
            resolution: "1920x1080",
            frameRate: 30,
            bitrate: 8000000,
            videoCodec: "H264",
            audioCodec: "OPUS",
            sampleRate: 48000,
            channels: 2
        )
        await streamService.setStreamConfig(config)
        
        streamService.onDeviceDiscovered = { [weak self] device in
            DispatchQueue.main.async {
                self?.devices.append(device)
            }
        }
        
        streamService.onConnectionStatusChanged = { [weak self] status in
            DispatchQueue.main.async {
                self?.isConnected = status.isConnected
                self?.status = status.statusString
                self?.latencyMs = status.latencyMs
                self?.bitrateMbps = status.bitrateMbps
                self?.frameRate = status.frameRate
            }
        }
        
        streamService.onVideoFrame = { [weak self] image in
            DispatchQueue.main.async {
                self?.videoFrame = image
            }
        }
    }
    
    func startScanning() {
        devices.removeAll()
        status = "Scanning..."
        
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            self.devices.append(DeviceInfo(
                deviceId: "ios-001",
                deviceName: "iPhone",
                ipAddress: "192.168.1.100",
                port: 8080,
                supportsVideo: true,
                supportsAudio: true,
                resolutions: ["1280x720", "1920x1080", "3840x2160"],
                frameRates: [30, 60]
            ))
            DispatchQueue.main.async {
                self.status = "Scan complete"
            }
        }
    }
    
    func selectDevice(_ device: DeviceInfo) {
        selectedDevice = device
    }
    
    func connect() async {
        guard let device = selectedDevice else { return }
        
        status = "Connecting..."
        
        do {
            try await streamService.connect(to: device)
            status = "Connected"
        } catch {
            status = "Connection failed: \(error.localizedDescription)"
        }
    }
    
    func disconnect() async {
        await streamService.disconnect()
        status = "Disconnected"
        videoFrame = nil
    }
    
    func switchCamera() async {
        status = "Switching camera..."
    }
    
    func toggleTorch() async {
        torchOn.toggle()
        status = torchOn ? "Torch on" : "Torch off"
    }
}

struct DeviceInfo: Identifiable, Equatable {
    let id: String
    let deviceId: String
    let deviceName: String
    let ipAddress: String
    let port: Int
    let supportsVideo: Bool
    let supportsAudio: Bool
    let resolutions: [String]
    let frameRates: [Int]
    
    static func == (lhs: DeviceInfo, rhs: DeviceInfo) -> Bool {
        lhs.deviceId == rhs.deviceId
    }
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
