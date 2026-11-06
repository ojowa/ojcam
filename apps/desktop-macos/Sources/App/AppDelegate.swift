//
//  AppDelegate.swift
//  Ojowacam Desktop
//

import Cocoa
import SwiftUI

@main
struct OjowacamApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(TitleBarWindowStyle())
        .commands {
            CommandMenu("Ojowacam") {
                Button("Scan for Devices") {
                    appDelegate.discoveryService.startScanning()
                }
                Button("Disconnect") {
                    appDelegate.streamService.disconnect()
                }
            }
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var discoveryService = DiscoveryService()
    var pairingService = PairingService()
    var streamService = StreamReceiverService()
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Configure stream settings
        let config = StreamConfig(
            resolution: "1920x1080",
            frameRate: 30,
            bitrate: 8000000,
            videoCodec: "H264",
            audioCodec: "OPUS",
            sampleRate: 48000,
            channels: 2
        )
        Task {
            await streamService.setStreamConfig(config)
        }
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        Task {
            await streamService.disconnect()
        }
    }
}
