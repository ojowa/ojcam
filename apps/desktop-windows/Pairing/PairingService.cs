using System;
using System.Collections.Generic;
using System.Linq;

namespace Ojowacam.Pairing;

public class PairingResult
{
    public bool Success { get; set; }
    public string? SessionToken { get; set; }
    public string? ErrorMessage { get; set; }
}

/// <summary>
/// Represents a pending pairing code waiting for validation by the desktop.
/// </summary>
public class PendingPairing
{
    public string Code { get; set; } = string.Empty;
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public string DevicePublicKey { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public bool IsValidated { get; set; }
    public string? SessionToken { get; set; }
}

public class PairingService
{
    public event EventHandler<string>? PairingCodeGenerated;

    private readonly Dictionary<string, PendingPairing> _pendingPairings = new();
    private readonly object _lock = new();

    public TimeSpan CodeExpiration { get; set; } = TimeSpan.FromMinutes(10);

    public string GeneratePairingCode()
    {
        var random = new Random();
        var code = random.Next(100000, 999999).ToString();

        PairingCodeGenerated?.Invoke(this, code);
        return code;
    }

    public void RegisterPendingPairing(string code, string deviceId, string deviceName, string devicePublicKey)
    {
        lock (_lock)
        {
            _pendingPairings[code] = new PendingPairing
            {
                Code = code,
                DeviceId = deviceId,
                DeviceName = deviceName,
                DevicePublicKey = devicePublicKey,
                ExpiresAt = DateTime.UtcNow.Add(CodeExpiration),
                IsValidated = false,
                SessionToken = Guid.NewGuid().ToString()
            };
        }
    }

    public PairingResult ValidatePairingCode(string code, string deviceId)
    {
        lock (_lock)
        {
            if (!_pendingPairings.TryGetValue(code, out var pending))
            {
                return new PairingResult
                {
                    Success = false,
                    ErrorMessage = "Invalid pairing code"
                };
            }

            if (pending.IsValidated)
            {
                return new PairingResult
                {
                    Success = false,
                    ErrorMessage = "Pairing code already used"
                };
            }

            if (DateTime.UtcNow > pending.ExpiresAt)
            {
                pending.IsValidated = true;
                return new PairingResult
                {
                    Success = false,
                    ErrorMessage = "Pairing code has expired"
                };
            }

            if (pending.DeviceId != deviceId)
            {
                return new PairingResult
                {
                    Success = false,
                    ErrorMessage = "Device ID mismatch"
                };
            }

            pending.IsValidated = true;

            return new PairingResult
            {
                Success = true,
                SessionToken = pending.SessionToken
            };
        }
    }

    public void CleanupExpired()
    {
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            var expired = _pendingPairings
                .Where(kvp => kvp.Value.ExpiresAt < now)
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var key in expired)
            {
                _pendingPairings.Remove(key);
            }
        }
    }

    public int PendingCount
    {
        get
        {
            lock (_lock)
            {
                var now = DateTime.UtcNow;
                return _pendingPairings.Count(kvp =>
                    !kvp.Value.IsValidated && kvp.Value.ExpiresAt > now);
            }
        }
    }
}
