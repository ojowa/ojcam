//
//  ContentView+Extensions.swift
//  Ojowacam Desktop
//

import SwiftUI

extension ContentView {
    private var mainContent: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            if let image = viewModel.videoFrame {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                VStack {
                    Image(systemName: "video.slash")
                        .font(.system(size: 60))
                        .foregroundColor(.gray)
                    Text("No video stream")
                        .foregroundColor(.gray)
                        .font(.headline)
                }
            }
            
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    HStack(spacing: 12) {
                        CameraControlButton(
                            title: "Switch Camera",
                            icon: "camera.rotate",
                            isEnabled: viewModel.isConnected,
                            action: { Task { await viewModel.switchCamera() } }
                        )
                        CameraControlButton(
                            title: "Torch",
                            icon: viewModel.torchOn ? "flashlight.on.fill" : "flashlight.off",
                            isEnabled: viewModel.isConnected,
                            action: { Task { await viewModel.toggleTorch() } }
                        )
                        CameraControlButton(
                            title: "Stop",
                            icon: "stop.fill",
                            isEnabled: viewModel.isConnected,
                            action: { Task { await viewModel.disconnect() } }
                        )
                        .foregroundColor(.red)
                    }
                    .padding()
                }
            }
        }
    }
    
    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Connection Status")
                .font(.headline)
            
            HStack {
                Circle()
                    .fill(viewModel.isConnected ? Color.green : Color.red)
                    .frame(width: 10, height: 10)
                Text(viewModel.status)
                    .foregroundColor(.secondary)
            }
            
            VStack(spacing: 10) {
                Button(action: {
                    Task { await viewModel.connect() }
                }) {
                    Label("Connect", systemImage: "plug.fill")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.canConnect)
                
                Button(action: {
                    Task { await viewModel.disconnect() }
                }) {
                    Label("Disconnect", systemImage: "power")
                }
                .buttonStyle(.bordered)
                .disabled(!viewModel.isConnected)
            }
        }
    }
    
    private var qualitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Video Quality")
                .font(.subheadline)
                .fontWeight(.semibold)
            
            Picker("Quality", selection: $viewModel.selectedQuality) {
                Text("720p 30fps").tag("720p")
                Text("1080p 30fps").tag("1080p")
                Text("1080p 60fps").tag("1080p60")
                Text("4K 30fps").tag("4K")
            }
            .pickerStyle(.segmented)
        }
    }
    
    private var statsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Stats")
                .font(.subheadline)
                .fontWeight(.semibold)
            
            HStack {
                Text("Latency:")
                Spacer()
                Text("\(viewModel.latencyMs) ms")
            }
            HStack {
                Text("Bitrate:")
                Spacer()
                Text(String(format: "%.1f Mbps", viewModel.bitrateMbps))
            }
            HStack {
                Text("FPS:")
                Spacer()
                Text("\(viewModel.frameRate)")
            }
        }
    }
}

struct DeviceRow: View {
    let device: DeviceInfo
    let isSelected: Bool
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(device.deviceName)
                    .font(.headline)
                Text(device.ipAddress)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.blue)
            }
        }
        .padding(.vertical, 4)
        .background(isSelected ? Color.blue.opacity(0.1) : Color.clear)
        .cornerRadius(8)
    }
}

struct CameraControlButton: View {
    let title: String
    let icon: String
    let isEnabled: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                Text(title)
                    .font(.caption2)
            }
            .frame(width: 60, height: 60)
            .background(Color.white.opacity(0.2))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1.0 : 0.5)
    }
}
