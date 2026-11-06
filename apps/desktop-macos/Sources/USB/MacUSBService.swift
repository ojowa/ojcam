//
//  MacUSBService.swift
//  Ojowacam Desktop
//

import Foundation
import SystemConfiguration

class MacUSBService {
    private var isMonitoring = false
    private var monitorTimer: Timer?
    
    var onDeviceConnected: ((USBDeviceInfo) -> Void)?
    var onDeviceDisconnected: ((USBDeviceInfo) -> Void)?
    var onStatusChanged: ((String) -> Void)?
    
    private var knownDevices: [String: USBDeviceInfo] = [:]
    
    func getConnectedDevices() async -> [USBDeviceInfo] {
        var devices: [USBDeviceInfo] = []
        
        let adbDevices = await detectADBDevices()
        devices.append(contentsOf: adbDevices)
        
        let usbDevices = detectUSBTetheringInterfaces()
        devices.append(contentsOf: usbDevices)
        
        return devices
    }
    
    private func detectADBDevices() async -> [USBDeviceInfo] {
        var devices: [USBDeviceInfo] = []
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/adb")
        process.arguments = ["devices", "-l"]
        
        let pipe = Pipe()
        process.standardOutput = pipe
        
        do {
            try process.run()
            process.waitUntilExit()
            
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            
            let lines = output.components(separatedBy: "\n").filter { !$0.isEmpty }
            for line in lines.dropFirst() {
                let parts = line.components(separatedBy: " ").filter { !$0.isEmpty }
                if parts.count >= 2, parts[1] == "device" {
                    let deviceId = parts[0]
                    let model = extractModelFromADBLine(line)
                    
                    let device = USBDeviceInfo(
                        deviceId: deviceId,
                        deviceName: model,
                        connectionType: "adb",
                        localPort: 0,
                        isConnected: true
                    )
                    devices.append(device)
                }
            }
        } catch {
            onStatusChanged?("ADB detection error: \(error.localizedDescription)")
        }
        
        return devices
    }
    
    private func extractModelFromADBLine(_ line: String) -> String {
        let pattern = "model:"
        if let range = line.range(of: pattern) {
            let afterModel = String(line[range.upperBound...])
            let components = afterModel.components(separatedBy: " ")
            return components.first?.trimmingCharacters(in: .whitespaces) ?? "Android Device"
        }
        return "Android Device"
    }
    private func detectUSBTetheringInterfaces() -> [USBDeviceInfo] {
        var devices: [USBDeviceInfo] = []
        
        var interfaces: UnsafeMutablePointer<SCNetworkInterface>?
        let count = SCNetworkInterfaceGetAllInterfaces(&interfaces)
        
        guard count > 0, let interfacePtr = interfaces else {
            return devices
        }
        
        for i in 0..<count {
            let interface = interfacePtr[Int(i)]
            let bsdName = SCNetworkInterfaceGetBSDName(interface) as String? ?? ""
            let interfaceType = SCNetworkInterfaceGetInterfaceType(interface) as String? ?? ""
            
            if interfaceType == kSCNetworkInterfaceTypeEthernet as String {
                let name = bsdName.lowercased()
                if bsdName.hasPrefix("en") {
                    if let addresses = getIPAddressesForInterface(bsdName: bsdName) {
                        for ip in addresses {
                            let device = USBDeviceInfo(
                                deviceId: "usb-\(bsdName)",
                                deviceName: "USB Tethering (\(bsdName))",
                                connectionType: "usb-tethering",
                                localIpAddress: ip,
                                localPort: 0,
                                isConnected: true
                            )
                            devices.append(device)
                        }
                    }
                }
            }
        }
        
        return devices
    }

    private func getIPAddressesForInterface(bsdName: String) -> [String]? {
        var addresses: [String] = []
        
        var interfaceAddrs: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaceAddrs) == 0 else { return nil }
        
        var ptr = interfaceAddrs
        while ptr != nil {
            let interface = ptr!.pointee
            let name = String(cString: interface.ifa_name)
            
            if name == bsdName {
                let addr = interface.ifa_addr
                if addr != nil {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    getnameinfo(addr, socklen_t(interface.ifa_addr?.pointee.sa_len ?? 0),
                                &hostname, socklen_t(hostname.count),
                                nil, 0, NI_NUMERICHOST)
                    let ip = String(cString: hostname)
                    if ip.contains(".") {
                        addresses.append(ip)
                    }
                }
            }
            ptr = interface.ifa_next
        }
        
        freeifaddrs(interfaceAddrs)
        return addresses.isEmpty ? nil : addresses
    }
    
    func startADBReverse(deviceId: String, localPort: Int, remotePort: Int) async -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/adb")
        process.arguments = ["-s", deviceId, "reverse", "tcp:\(remotePort)", "tcp:\(localPort)"]
        
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            onStatusChanged?("ADB reverse error: \(error.localizedDescription)")
            return false
        }
    }
    
    func removeADBReverse(deviceId: String, localPort: Int) async -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/adb")
        process.arguments = ["-s", deviceId, "reverse", "--remove", "tcp:\(localPort)"]
        
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            onStatusChanged?("ADB reverse remove error: \(error.localizedDescription)")
            return false
        }
    }
    
    func startMonitoring(intervalSeconds: Double = 5.0) {
        isMonitoring = true
        monitorTimer = Timer.scheduledTimer(withTimeInterval: intervalSeconds, repeats: true) { _ in
            Task {
                await self.checkDeviceChanges()
            }
        }
    }
    
    func stopMonitoring() {
        isMonitoring = false
        monitorTimer?.invalidate()
        monitorTimer = nil
    }
    
    private func checkDeviceChanges() async {
        let currentDevices = await getConnectedDevices()
        let currentIds = Set(currentDevices.map { $0.deviceId })
        
        for device in currentDevices {
            if knownDevices[device.deviceId] == nil {
                knownDevices[device.deviceId] = device
                DispatchQueue.main.async {
                    self.onDeviceConnected?(device)
                }
            }
        }
        
        let knownIds = Set(knownDevices.keys)
        for id in knownIds where !currentIds.contains(id) {
            knownDevices.removeValue(forKey: id)
            DispatchQueue.main.async {
                let device = USBDeviceInfo(
                    deviceId: id,
                    deviceName: "",
                    connectionType: "",
                    localPort: 0,
                    isConnected: false
                )
                self.onDeviceDisconnected?(device)
            }
        }
    }
}

struct USBDeviceInfo: Identifiable, Equatable {
    let id: String
    let deviceId: String
    let deviceName: String
    let connectionType: String
    let localIpAddress: String
    let localPort: Int
    let isConnected: Bool
    
    static func == (lhs: USBDeviceInfo, rhs: USBDeviceInfo) -> Bool {
        lhs.deviceId == rhs.deviceId
    }
}

