using System;
using System.Collections.ObjectModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Ojowacam.Desktop.Models;
using Ojowacam.Desktop.Services;

namespace Ojowacam.Desktop.UI;

public partial class MainWindow : Window
{
    private readonly StreamReceiverService _streamService;
    private readonly ObservableCollection<DeviceInfo> _devices = new();
    private DeviceInfo? _selectedDevice;

    public MainWindow()
    {
        InitializeComponent();
        _streamService = new StreamReceiverService("ws://localhost:8080");
        DeviceList.ItemsSource = _devices;

        _streamService.DeviceDiscovered += OnDeviceDiscovered;
        _streamService.ConnectionStatusChanged += OnConnectionStatusChanged;
        _streamService.VideoFrameReady += OnVideoFrameReady;
        _streamService.AudioSamplesReady += OnAudioSamplesReady;
        _streamService.PairingCodeGenerated += OnPairingCodeGenerated;
        _streamService.PairingCompleted += OnPairingCompleted;
    }

    private void OnPairingCodeGenerated(object? sender, string code)
    {
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = $"Pairing code: {code}";
        });
    }

    private void OnPairingCompleted(object? sender, Ojowacam.Pairing.PairingResult result)
    {
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = result.Success
                ? "Pairing complete"
                : $"Pairing failed: {result.ErrorMessage}";
        });
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        var config = new StreamConfig
        {
            Resolution = "1920x1080",
            FrameRate = 30,
            Bitrate = 8000000,
            VideoCodec = "H264",
            AudioCodec = "OPUS",
            SampleRate = 48000,
            Channels = 2
        };
        await _streamService.SetStreamConfigAsync(config);
    }

    private async void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        await _streamService.DisconnectAsync();
    }

    private async void ScanDevices_Click(object sender, RoutedEventArgs e)
    {
        _devices.Clear();
        StatusText.Text = "Scanning...";

        await Task.Delay(1000);
        _devices.Add(new DeviceInfo
        {
            DeviceId = "android-001",
            DeviceName = "Android Phone",
            IpAddress = "192.168.1.100",
            Port = 8080,
            SupportsVideo = true,
            SupportsAudio = true,
            Resolutions = { "1280x720", "1920x1080", "3840x2160" },
            FrameRates = { 30, 60 }
        });

        StatusText.Text = "Scan complete";
        ConnectButton.IsEnabled = _devices.Count > 0;
    }

    private void DeviceList_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        _selectedDevice = DeviceList.SelectedItem as DeviceInfo;
        ConnectButton.IsEnabled = _selectedDevice != null;
    }

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedDevice == null) return;

        try
        {
            ConnectButton.IsEnabled = false;
            StatusText.Text = "Connecting...";

            await _streamService.ConnectToDeviceAsync(_selectedDevice);

            DisconnectButton.IsEnabled = true;
            SwitchCameraButton.IsEnabled = true;
            TorchButton.IsEnabled = true;
            StopStreamingButton.IsEnabled = true;
            NoVideoText.Visibility = System.Windows.Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Error: {ex.Message}";
            ConnectButton.IsEnabled = true;
        }
    }

    private async void Disconnect_Click(object sender, RoutedEventArgs e)
    {
        await _streamService.DisconnectAsync();
        ConnectButton.IsEnabled = true;
        DisconnectButton.IsEnabled = false;
        SwitchCameraButton.IsEnabled = false;
        TorchButton.IsEnabled = false;
        StopStreamingButton.IsEnabled = false;
        NoVideoText.Visibility = System.Windows.Visibility.Visible;
        VideoPreview.Source = null;
        StatusText.Text = "Disconnected";
    }

    private async void SwitchCamera_Click(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Switching camera...";
    }

    private async void Torch_Click(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Toggling torch...";
    }

    private async void StopStreaming_Click(object sender, RoutedEventArgs e)
    {
        await _streamService.DisconnectAsync();
        ConnectButton.IsEnabled = true;
        DisconnectButton.IsEnabled = false;
        SwitchCameraButton.IsEnabled = false;
        TorchButton.IsEnabled = false;
        StopStreamingButton.IsEnabled = false;
        NoVideoText.Visibility = System.Windows.Visibility.Visible;
        VideoPreview.Source = null;
        StatusText.Text = "Stopped";
    }

    private void OnDeviceDiscovered(object sender, DeviceInfo device)
    {
        Dispatcher.Invoke(() =>
        {
            _devices.Add(device);
            ConnectButton.IsEnabled = true;
        });
    }

    private void OnConnectionStatusChanged(object sender, ConnectionStatus status)
    {
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = status.Status;
            LatencyText.Text = $"Latency: {status.LatencyMs} ms";
            BitrateText.Text = $"Bitrate: {status.BitrateMbps:F1} Mbps";
            FpsText.Text = $"FPS: {status.FrameRate}";
        });
    }

    private void OnVideoFrameReady(object sender, Bitmap bitmap)
    {
        Dispatcher.Invoke(() =>
        {
            var bitmapSource = BitmapToBitmapSource(bitmap);
            VideoPreview.Source = bitmapSource;
            bitmap.Dispose();
        });
    }

    private void OnAudioSamplesReady(object sender, float[] samples)
    {
        // Audio is rendered by AudioRenderer via WASAPI
    }

    private static BitmapSource BitmapToBitmapSource(Bitmap bitmap)
    {
        using var memory = new MemoryStream();
        bitmap.Save(memory, ImageFormat.Bmp);
        memory.Position = 0;

        var bitmapImage = new BitmapImage();
        bitmapImage.BeginInit();
        bitmapImage.CacheOption = BitmapCacheOption.OnLoad;
        bitmapImage.StreamSource = memory;
        bitmapImage.EndInit();
        bitmapImage.Freeze();
        return bitmapImage;
    }
}
