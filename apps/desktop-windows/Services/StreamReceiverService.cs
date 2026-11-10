using System;
using System.Collections.Generic;
using System.Drawing;
using System.Text.Json;
using System.Threading.Tasks;
using Ojowacam.Desktop.Models;
using Ojowacam.Desktop.Services.Signaling;
using Ojowacam.Desktop.Services.WebRTC;
using Ojowacam.Desktop.Services.Decoder;
using Ojowacam.Desktop.Services.Audio;
using Ojowacam.Pairing;

namespace Ojowacam.Desktop.Services;

public class StreamReceiverService
{
    private readonly SignalingService _signaling;
    private readonly WebRTCReceiverService _webRTC;
    private readonly WebRTCCallbacks _webRTCCallbacks;
    private readonly H264VideoDecoder _videoDecoder;
    private readonly AudioRenderer _audioRenderer;
    private readonly PairingService _pairing;
    private readonly DesktopIdentity _identity;

    private DeviceInfo? _currentDevice;
    private StreamConfig _config = new();
    private bool _isStreaming = false;

    public event EventHandler<DeviceInfo>? DeviceDiscovered;
    public event EventHandler<ConnectionStatus>? ConnectionStatusChanged;
    public event EventHandler<Bitmap>? VideoFrameReady;
    public event EventHandler<float[]>? AudioSamplesReady;
    public event EventHandler<string>? PairingCodeGenerated;
    public event EventHandler<PairingResult>? PairingCompleted;

    public StreamReceiverService(string signalingUrl)
    {
        _signaling = new SignalingService(signalingUrl);
        _webRTCCallbacks = new WebRTCCallbacks();
        _webRTC = new WebRTCReceiverService(_webRTCCallbacks);
        _videoDecoder = new H264VideoDecoder();
        _audioRenderer = new AudioRenderer();
        _pairing = new PairingService();
        _identity = DesktopIdentity.Create();

        _pairing.PairingCodeGenerated += (_, code) => PairingCodeGenerated?.Invoke(this, code);

        SetupEventHandlers();
    }

    public string GeneratePairingCode() => _pairing.GeneratePairingCode();
    public int PendingPairingCount => _pairing.PendingCount;
    public string DesktopPublicKey => _identity.PublicKeyBase64;
    public string DesktopDeviceId => _identity.DeviceId;

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

        _webRTCCallbacks.OnLocalSdp += async (type, sdp) =>
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

        _webRTCCallbacks.OnIceCandidate += async (candidate) =>
        {
            await _signaling.SendAsync(new SignalingMessage
            {
                Type = "ICE_CANDIDATE",
                Candidate = candidate,
                SessionId = _webRTC.SessionId,
                DeviceId = _currentDevice?.DeviceId
            });
        };

        _webRTCCallbacks.OnVideoFrame += async (frameData) =>
        {
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
        var sessionId = Guid.NewGuid().ToString();
        await _signaling.SendAsync(new SignalingMessage
        {
            Type = "PAIRING_REQUEST",
            DeviceId = device.DeviceId,
            SessionId = sessionId
        });

        // Initialize WebRTC
        await _webRTC.InitializeAsync();
        await _webRTC.CreateOfferAsync(sessionId);

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

    private async void OnSignalingMessage(object? sender, SignalingMessage message)
    {
        switch (message.Type)
        {
            case "ANSWER":
                await _webRTC.SetRemoteDescriptionAsync(message.SdpType ?? "answer", message.Sdp ?? "");
                break;
            case "ICE_CANDIDATE":
                await _webRTC.AddIceCandidateAsync(message.Candidate ?? "");
                break;
            case "PAIRING_REQUEST":
                await HandlePairingRequestAsync(message);
                break;
            case "PAIRING_RESPONSE":
                if (message.DeviceId != null)
                {
                    _currentDevice = new DeviceInfo
                    {
                        DeviceId = message.DeviceId,
                        DeviceName = message.DeviceName ?? message.DeviceId,
                        IpAddress = "0.0.0.0",
                        SupportsVideo = true,
                        SupportsAudio = true
                    };
                }
                break;
        }
    }

    private async Task HandlePairingRequestAsync(SignalingMessage message)
    {
        var deviceId = message.DeviceId;
        var pairingCode = message.PairingCode;

        if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(pairingCode))
        {
            await _signaling.SendAsync(new SignalingMessage
            {
                Type = "PAIRING_RESPONSE",
                Success = false,
                ErrorMessage = "Pairing request missing device id or code",
                DeviceId = deviceId,
                PairingCode = pairingCode
            });
            return;
        }

        PairingResult result;
        if (_pairing.HasPendingCode(pairingCode))
        {
            // Desktop-initiated pairing: validate the code entered on mobile.
            result = _pairing.ValidatePairingCode(pairingCode, deviceId);
        }
        else
        {
            // Mobile-initiated pairing: mint a session token and sign the response.
            result = new PairingResult
            {
                Success = true,
                SessionToken = Guid.NewGuid().ToString()
            };
        }

        if (!result.Success)
        {
            await _signaling.SendAsync(new SignalingMessage
            {
                Type = "PAIRING_RESPONSE",
                Success = false,
                ErrorMessage = result.ErrorMessage,
                DeviceId = deviceId,
                PairingCode = pairingCode
            });
            PairingCompleted?.Invoke(this, result);
            return;
        }

        var sessionToken = result.SessionToken ?? Guid.NewGuid().ToString();

        // Property order must match mobile: JSON.stringify({ deviceId, pairingCode, sessionToken, success })
        var payload = JsonSerializer.Serialize(new
        {
            deviceId,
            pairingCode,
            sessionToken,
            success = true
        });

        var signature = _identity.Sign(payload);

        _currentDevice = new DeviceInfo
        {
            DeviceId = deviceId,
            DeviceName = message.DeviceName ?? deviceId,
            IpAddress = "0.0.0.0",
            SupportsVideo = true,
            SupportsAudio = true
        };

        await _signaling.SendAsync(new SignalingMessage
        {
            Type = "PAIRING_RESPONSE",
            Success = true,
            DeviceId = deviceId,
            PairingCode = pairingCode,
            SessionToken = sessionToken,
            Signature = signature,
            SignerPublicKey = _identity.PublicKeyBase64
        });
        PairingCompleted?.Invoke(this, new PairingResult { Success = true, SessionToken = sessionToken });
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
