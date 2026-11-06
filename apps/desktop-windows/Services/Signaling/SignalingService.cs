using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Ojowacam.Desktop.Models;

namespace Ojowacam.Desktop.Services.Signaling;

public class SignalingService
{
    private ClientWebSocket? _webSocket;
    private readonly Uri _serverUrl;
    private CancellationTokenSource? _cts;
    private bool _isConnected = false;

    public event EventHandler<SignalingMessage>? MessageReceived;
    public event EventHandler<bool>? ConnectionStateChanged;

    public SignalingService(string serverUrl)
    {
        _serverUrl = new Uri(serverUrl);
    }

    public async Task ConnectAsync()
    {
        try
        {
            _webSocket = new ClientWebSocket();
            _cts = new CancellationTokenSource();

            await _webSocket.ConnectAsync(_serverUrl, _cts.Token);
            _isConnected = true;
            ConnectionStateChanged?.Invoke(this, true);

            _ = Task.Run(() => ReceiveLoop(_cts.Token));
        }
        catch (Exception ex)
        {
            _isConnected = false;
            ConnectionStateChanged?.Invoke(this, false);
            throw new SignalingException("Failed to connect to signaling server", ex);
        }
    }

    public async Task DisconnectAsync()
    {
        _isConnected = false;
        _cts?.Cancel();

        if (_webSocket != null && _webSocket.State == WebSocketState.Open)
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnecting", CancellationToken.None);
        }
    }

    public async Task SendAsync(SignalingMessage message)
    {
        if (!_isConnected || _webSocket == null)
            throw new InvalidOperationException("Not connected to signaling server");

        var json = JsonConvert.SerializeObject(message);
        var bytes = Encoding.UTF8.GetBytes(json);
        var segment = new ArraySegment<byte>(bytes);

        await _webSocket.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private async Task ReceiveLoop(CancellationToken ct)
    {
        var buffer = new byte[4096];

        while (_isConnected && !ct.IsCancellationRequested)
        {
            try
            {
                var result = await _webSocket!.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _isConnected = false;
                    ConnectionStateChanged?.Invoke(this, false);
                    break;
                }

                var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                var message = JsonConvert.DeserializeObject<SignalingMessage>(json);

                if (message != null)
                {
                    MessageReceived?.Invoke(this, message);
                }
            }
            catch (Exception ex)
            {
                _isConnected = false;
                ConnectionStateChanged?.Invoke(this, false);
                break;
            }
        }
    }

    public bool IsConnected => _isConnected;
}

public class SignalingException : Exception
{
    public SignalingException(string message, Exception inner) : base(message, inner) { }
}
