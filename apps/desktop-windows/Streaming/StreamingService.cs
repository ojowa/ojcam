using System;

namespace Ojowacam.Streaming;

public class StreamConfig
{
    public string Resolution { get; set; } = "1920x1080";
    public int FrameRate { get; set; } = 30;
    public string VideoCodec { get; set; } = "H264";
    public int Bitrate { get; set; } = 5000000;
    public string AudioCodec { get; set; } = "OPUS";
    public int SampleRate { get; set; } = 48000;
    public int Channels { get; set; } = 2;
}

public class StreamingService
{
    public event EventHandler<float>? FrameReceived;
    public event EventHandler<string>? ConnectionStatusChanged;

    private StreamConfig _config = new();
    private bool _isStreaming = false;

    public async Task StartStreamingAsync(string deviceId, StreamConfig config)
    {
        _config = config;
        _isStreaming = true;
        
        // TODO: Implement WebRTC receiver
        ConnectionStatusChanged?.Invoke(this, "Connecting...");
        
        await Task.Run(() =>
        {
            while (_isStreaming)
            {
                // Receive and decode video frames
                // Raise FrameReceived event
            }
        });
    }

    public void StopStreaming()
    {
        _isStreaming = false;
        ConnectionStatusChanged?.Invoke(this, "Disconnected");
    }
}
