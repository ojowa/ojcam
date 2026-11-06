//
//  DiscoveryService.swift
//  Ojowacam Desktop
//

import Foundation

class DiscoveryService {
    private var netServiceBrowser: NetServiceBrowser?
    private var discoveredServices: [NetService] = []
    
    var onDeviceDiscovered: ((DeviceInfo) -> Void)?
    
    func startScanning() {
        netServiceBrowser = NetServiceBrowser()
        netServiceBrowser?.delegate = self
        netServiceBrowser?.searchForServices(ofType: "_ojowacam._tcp.", inDomain: "local.")
    }
    
    func stopScanning() {
        netServiceBrowser?.stop()
        netServiceBrowser = nil
    }
}

extension DiscoveryService: NetServiceBrowserDelegate {
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        service.resolve(withTimeout: 5.0)
    }
    
    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        // Remove device from list
    }
}

extension DiscoveryService: NetServiceDelegate {
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let addresses = sender.addresses,
              let data = addresses.first,
              data.count >= 4 else { return }
        
        var address = data.withUnsafeBytes { ptr in
            var addr = in_addr()
            memcpy(&addr, ptr.baseAddress!, 4)
            return String(cString: inet_ntoa(addr), encoding: .utf8) ?? "unknown"
        }
        
        let device = DeviceInfo(
            deviceId: sender.name,
            deviceName: sender.name,
            ipAddress: address,
            port: Int(sender.port),
            supportsVideo: true,
            supportsAudio: true,
            resolutions: ["1280x720", "1920x1080", "3840x2160"],
            frameRates: [30, 60]
        )
        
        onDeviceDiscovered?(device)
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
