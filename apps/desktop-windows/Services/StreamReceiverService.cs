using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Ojowacam.Desktop.Models;
using Ojowacam.Desktop.Services.Signaling;
using Ojowacam.Desktop.Services.WebRTC;
using Ojowacam.Desktop.Services.Decoder;
using Ojowacam.Desktop.Services.Audio;

namespace Ojowacam.Desktop.Services;

public class StreamReceiverService
{
    private readonly SignalingService _signaling;
    private readonly WebRTCReceiverService _webRTC;
    private readonly H264VideoDecoder _videoDecoder;
    private readonly AudioRenderer _audioRenderer;

    private DeviceInfo? _currentDevice;
    private StreamConfig _config = new();
    private bool _isStreaming = false;

    public event EventHandler<DeviceInfo>? DeviceDiscovered;
    public event EventHandler<ConnectionStatus>? ConnectionStatusChanged;
    public event EventHandler<Bitmap>? VideoFrameReady;
    public event EventHandler<float[]>? AudioSamplesReady;

    public StreamReceiverService(string signalingUrl)
    {
        _signaling = new SignalingService(signalingUrl);
        _webRTC = new WebRTCReceiverService(new WebRTCCallbacks());
        _videoDecoder = new H264VideoDecoder();
        _audioRenderer = new AudioRenderer();

        SetupEventHandlers();
    }

    private void SetupEventHandlers()
    {
        _signaling.MessageReceived += OnSignalingMessage;
        _signaling.ConnectionStateChanged += (sender, connected) =>
        {
            ConnectionStatusChanged?.Invoke(this, new ConnectionStatus
            {
                IsConnected = connected,
                Status = connected ? "Connected" : "Disconnected"
            });
        };

        _webRTC.OnLocalSdp += async (type, sdp) =>
        {
            await _signaling.SendAsync(new SignalingMessage
            {
                Type = type == "offer" ? "OFFER" : "ANSWER",
                Sdp = sdp,
                SdpType = type,
                SessionId = _webRTC.SessionId,
                DeviceId = _currentDevice?.DeviceId
            });
        };

        _webRTC.OnIceCandidate += async (candidate) =>
        {
            await _signaling.SendAsync(new SignalingMessage
            {
                Type = "ICE_CANDIDATE",
                Candidate = candidate,
                SessionId = _webRTC.SessionId,
                DeviceId = _currentDevice?.DeviceId
            });
        };

        _webRTC.OnVideoFrame += async (frameData) =>
        {
            // Decode and raise event
            await _videoDecoder.DecodeAsync(frameData, DateTimeOffset.Now.ToUnixTimeMilliseconds());
        };

        _videoDecoder.FrameDecoded += (sender, bitmap) =>
        {
            VideoFrameReady?.Invoke(this, bitmap);
        };

        _audioRenderer.AudioSamplesReady += (sender, samples) =>
        {
            AudioSamplesReady?.Invoke(this, samples);
        };
    }

    public async Task ConnectToDeviceAsync(DeviceInfo device)
    {
        _currentDevice = device;

        await _signaling.ConnectAsync();

        // Send pairing request
        await _signaling.SendAsync(new SignalingMessage
        {
            Type = "PAIRING_REQUEST",
            DeviceId = device.DeviceId,
            SessionId = Guid.NewGuid().ToString()
        });

        // Initialize WebRTC
        await _webRTC.InitializeAsync();
        await _webRTC.CreateOfferAsync(_signaling.ToString());

        _isStreaming = true;

        ConnectionStatusChanged?.Invoke(this, new ConnectionStatus
        {
            IsConnected = true,
            Status = "Connecting..."
        });
    }

    public async Task DisconnectAsync()
    {
        _isStreaming = false;
        await _webRTC.StopReceivingAsync();
        await _signaling.DisconnectAsync();

        ConnectionStatusChanged?.Invoke(this, new ConnectionStatus
        {
            IsConnected = false,
            Status = "Disconnected"
        });
    }

    private async Task OnSignalingMessage(object sender, SignalingMessage message)
    {
        switch (message.Type)
        {
            case "ANSWER":
                await _webRTC.SetRemoteDescriptionAsync(message.SdpType ?? "answer", message.Sdp ?? "");
                break;
            case "ICE_CANDIDATE":
                await _webRTC.AddIceCandidateAsync(message.Candidate ?? "");
                break;
            case "PAIRING_RESPONSE":
                if (message.DeviceId != null)
                {
                    _currentDevice = new DeviceInfo
                    {
                        DeviceId = message.DeviceId,
                        DeviceName = message.DeviceId,
                        IpAddress = "0.0.0.0",
                        SupportsVideo = true,
                        SupportsAudio = true
                    };
                }
                break;
        }
    }

    public async Task SetStreamConfigAsync(StreamConfig config)
    {
        _config = config;
        await _videoDecoder.InitializeAsync(
            int.Parse(config.Resolution.Split('x')[0]),
            int.Parse(config.Resolution.Split('x')[1])
        );
        await _audioRenderer.InitializeAsync(config.SampleRate, config.Channels);
    }

    public DeviceInfo? CurrentDevice => _currentDevice;
    public bool IsStreaming => _isStreaming;
}
