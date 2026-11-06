using System;
using System.Threading.Tasks;
using Ojowacam.Desktop.Models;

namespace Ojowacam.Desktop.Services.WebRTC;

public class WebRTCCallbacks
{
    public event Action<string, string>? OnLocalSdp;    // type, sdp
    public event Action<string>? OnIceCandidate;        // candidate
    public event Action<string>? OnConnectionStateChange; // state
    public event Action<byte[]>? OnVideoFrame;          // encoded frame
    public event Action<float[]>? OnAudioSamples;       // PCM samples
}

public class WebRTCReceiverService
{
    private readonly WebRTCCallbacks _callbacks;
    private bool _isConnected = false;
    private string? _sessionId;

    public WebRTCReceiverService(WebRTCCallbacks callbacks)
    {
        _callbacks = callbacks;
    }

    public async Task InitializeAsync()
    {
        // TODO: Initialize WebRTC peer connection factory (e.g., using Microsoft.Mediasoft.WebRTC)
        await Task.CompletedTask;
    }

    public async Task CreateOfferAsync(string sessionId)
    {
        _sessionId = sessionId;
        // TODO: Create WebRTC offer, invoke _callbacks.OnLocalSdp when ready
        await Task.CompletedTask;
    }

    public async Task SetRemoteDescriptionAsync(string type, string sdp)
    {
        // TODO: Set remote SDP answer
        await Task.CompletedTask;
    }

    public async Task AddIceCandidateAsync(string candidate)
    {
        // TODO: Add ICE candidate to peer connection
        await Task.CompletedTask;
    }

    public async Task StartReceivingAsync()
    {
        _isConnected = true;
        // TODO: Begin receiving video/audio tracks
        await Task.CompletedTask;
    }

    public async Task StopReceivingAsync()
    {
        _isConnected = false;
        // TODO: Close peer connection
        await Task.CompletedTask;
    }

    public bool IsConnected => _isConnected;
    public string? SessionId => _sessionId;
}
