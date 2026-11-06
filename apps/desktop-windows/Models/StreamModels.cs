namespace Ojowacam.Desktop.Models;

public class DeviceInfo
{
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public int Port { get; set; }
    public bool SupportsVideo { get; set; } = true;
    public bool SupportsAudio { get; set; } = true;
    public List<string> Resolutions { get; set; } = new();
    public List<int> FrameRates { get; set; } = new();
    public DateTime LastSeen { get; set; } = DateTime.Now;
}

public class StreamConfig
{
    public string Resolution { get; set; } = "1920x1080";
    public int FrameRate { get; set; } = 30;
    public string VideoCodec { get; set; } = "H264";
    public int Bitrate { get; set; } = 8000000;
    public string AudioCodec { get; set; } = "OPUS";
    public int SampleRate { get; set; } = 48000;
    public int Channels { get; set; } = 2;
}

public class SignalingMessage
{
    public string Type { get; set; } = string.Empty; // OFFER, ANSWER, ICE_CANDIDATE, PAIRING_REQUEST, PAIRING_RESPONSE
    public string? SessionId { get; set; }
    public string? Sdp { get; set; }
    public string? SdpType { get; set; }
    public string? Candidate { get; set; }
    public string? DeviceId { get; set; }
    public string? PairingCode { get; set; }
    public string? ErrorMessage { get; set; }
}

public class ConnectionStatus
{
    public bool IsConnected { get; set; }
    public string Status { get; set; } = "Disconnected";
    public int LatencyMs { get; set; }
    public double BitrateMbps { get; set; }
    public int FrameRate { get; set; }
    public int DroppedFrames { get; set; }
    public DateTime ConnectedAt { get; set; }
}
