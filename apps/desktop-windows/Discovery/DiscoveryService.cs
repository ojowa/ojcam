using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

namespace Ojowacam.Services;

public class DeviceInfo
{
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public IPAddress IpAddress { get; set; } = IPAddress.None;
    public int Port { get; set; }
    public bool SupportsVideo { get; set; } = true;
    public bool SupportsAudio { get; set; } = true;
    public List<string> Resolutions { get; set; } = new();
    public List<int> FrameRates { get; set; } = new();
}

public class DiscoveryService
{
    private const int DiscoveryPort = 5353;
    private readonly UdpClient _udpClient;
    private bool _isScanning = false;

    public event EventHandler<DeviceInfo>? DeviceFound;

    public DiscoveryService()
    {
        _udpClient = new UdpClient(DiscoveryPort);
    }

    public async Task StartScanningAsync()
    {
        _isScanning = true;
        // TODO: Implement mDNS/DNS-SD discovery
        await Task.Run(() =>
        {
            while (_isScanning)
            {
                // Listen for device announcements
            }
        });
    }

    public void StopScanning()
    {
        _isScanning = false;
    }
}
