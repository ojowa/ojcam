using System;

namespace Ojowacam.Pairing;

public class PairingResult
{
    public bool Success { get; set; }
    public string? SessionToken { get; set; }
    public string? ErrorMessage { get; set; }
}

public class PairingService
{
    public event EventHandler<string>? PairingCodeGenerated;

    public string GeneratePairingCode()
    {
        // Generate a 6-digit pairing code
        var random = new Random();
        var code = random.Next(100000, 999999).ToString();
        
        PairingCodeGenerated?.Invoke(this, code);
        return code;
    }

    public PairingResult ValidatePairingCode(string code, string deviceId)
    {
        // TODO: Implement pairing code validation with the mobile device
        return new PairingResult
        {
            Success = true,
            SessionToken = Guid.NewGuid().ToString()
        };
    }
}
