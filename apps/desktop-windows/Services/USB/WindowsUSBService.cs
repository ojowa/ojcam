using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Threading.Tasks;
using Ojowacam.Desktop.Models;

namespace Ojowacam.Desktop.Services.USB;

public class USBDeviceInfo
{
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public string ConnectionType { get; set; } = "adb";
    public string LocalIpAddress { get; set; } = string.Empty;
    public int LocalPort { get; set; }
    public bool IsConnected { get; set; }
}

public class WindowsUSBService
{
    private const string AdbPath = "adb";
    private readonly List<USBDeviceInfo> _devices = new();
    private bool _isMonitoring = false;
    private System.Threading.Timer? _monitorTimer;

    public event EventHandler<USBDeviceInfo>? DeviceConnected;
    public event EventHandler<USBDeviceInfo>? DeviceDisconnected;
    public event EventHandler<string>? StatusChanged;

    public async Task<List<USBDeviceInfo>> GetConnectedDevicesAsync()
    {
        _devices.Clear();
        await DetectADBDevicesAsync();
        DetectUSBTetheringInterfaces();
        return _devices.ToList();
    }

    private async Task DetectADBDevicesAsync()
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = AdbPath,
                Arguments = "devices -l",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(startInfo);
            if (process == null) return;

            string output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines.Skip(1))
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2 && parts[1] == "device")
                {
                    string deviceId = parts[0];
                    string model = ExtractModelFromADBLine(line);

                    _devices.Add(new USBDeviceInfo
                    {
                        DeviceId = deviceId,
                        DeviceName = model,
                        ConnectionType = "adb",
                        LocalPort = 0,
                        IsConnected = true
                    });

                    DeviceConnected?.Invoke(this, _devices.Last());
                }
            }
        }
        catch (Exception ex)
        {
            StatusChanged?.Invoke(this, $"ADB detection error: {ex.Message}");
        }
    }

    private string ExtractModelFromADBLine(string line)
    {
        var modelIndex = line.IndexOf("model:");
        if (modelIndex >= 0)
        {
            var afterModel = line.Substring(modelIndex + 6);
            var endIndex = afterModel.IndexOf(' ');
            if (endIndex >= 0)
                return afterModel.Substring(0, endIndex).Trim();
            return afterModel.Trim();
        }
        return "Android Device";
    }

    private void DetectUSBTetheringInterfaces()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Ethernet ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Ppp)
                {
                    string name = nic.Name.ToLower();
                    if (name.Contains("usb") || name.Contains("rndis") || name.Contains("ethernet"))
                    {
                        var ipProps = nic.GetIPProperties();
                        foreach (var addr in ipProps.UnicastAddresses)
                        {
                            if (addr.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                            {
                                _devices.Add(new USBDeviceInfo
                                {
                                    DeviceId = $"usb-{nic.Name}",
                                    DeviceName = $"USB Tethering ({nic.Name})",
                                    ConnectionType = "usb-tethering",
                                    LocalIpAddress = addr.Address.ToString(),
                                    LocalPort = 0,
                                    IsConnected = nic.OperationalStatus == OperationalStatus.Up
                                });

                                DeviceConnected?.Invoke(this, _devices.Last());
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            StatusChanged?.Invoke(this, $"USB tethering detection error: {ex.Message}");
        }
    }
    public async Task<bool> StartADBReverseAsync(string deviceId, int localPort, int remotePort)
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = AdbPath,
                Arguments = $"-s {deviceId} reverse tcp:{remotePort} tcp:{localPort}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(startInfo);
            if (process == null) return false;

            await process.WaitForExitAsync();
            return process.ExitCode == 0;
        }
        catch (Exception ex)
        {
            StatusChanged?.Invoke(this, $"ADB reverse error: {ex.Message}");
            return false;
        }
    }

    public async Task<bool> RemoveADBReverseAsync(string deviceId, int localPort)
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = AdbPath,
                Arguments = $"-s {deviceId} reverse --remove tcp:{localPort}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(startInfo);
            if (process == null) return false;

            await process.WaitForExitAsync();
            return process.ExitCode == 0;
        }
        catch (Exception ex)
        {
            StatusChanged?.Invoke(this, $"ADB reverse remove error: {ex.Message}");
            return false;
        }
    }

    public void StartMonitoring(int intervalMs = 5000)
    {
        _isMonitoring = true;
        _monitorTimer = new System.Threading.Timer(async _ =>
        {
            if (_isMonitoring)
            {
                await GetConnectedDevicesAsync();
            }
        }, null, intervalMs, intervalMs);
    }

    public void StopMonitoring()
    {
        _isMonitoring = false;
        _monitorTimer?.Dispose();
        _monitorTimer = null;
    }

    public List<USBDeviceInfo> GetDevices() => _devices.ToList();
}
