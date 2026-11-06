//
//  ContentView.swift
//  Ojowacam Desktop
//

import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = DesktopViewModel()
    
    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            mainContent
        }
        .task {
            await viewModel.initialize()
        }
    }
    
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Ojowacam Desktop")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text("Devices")
                .font(.headline)
            
            List(viewModel.devices, id: \.deviceId) { device in
                DeviceRow(device: device, isSelected: viewModel.selectedDevice?.deviceId == device.deviceId)
                    .onTapGesture {
                        viewModel.selectDevice(device)
                    }
            }
            .frame(maxHeight: 300)
            
            Button(action: {
                viewModel.startScanning()
            }) {
                Label("Scan for Devices", systemImage: "magnifyingglass")
            }
            .buttonStyle(.borderedProminent)
            
            Divider()
            
            statusSection
            qualitySection
            statsSection
            
            Spacer()
        }
        .padding()
        .frame(minWidth: 350)
    }
}
