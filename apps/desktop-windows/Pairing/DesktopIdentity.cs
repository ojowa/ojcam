using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Ojowacam.Pairing;

/// <summary>
/// Desktop ECDSA P-256 identity used to sign pairing responses.
/// Public key format matches mobile: base64url(JSON JWK).
/// </summary>
public sealed class DesktopIdentity : IDisposable
{
    private ECDsa? _ecdsa;

    public string PublicKeyBase64 { get; private set; } = string.Empty;
    public string DeviceId { get; private set; } = string.Empty;

    public static DesktopIdentity Create()
    {
        var identity = new DesktopIdentity();
        identity.Initialize();
        return identity;
    }

    private void Initialize()
    {
        _ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = _ecdsa.ExportParameters(false);

        var jwk = new Dictionary<string, string>
        {
            ["kty"] = "EC",
            ["crv"] = "P-256",
            ["x"] = Base64UrlEncode(parameters.Q.X!),
            ["y"] = Base64UrlEncode(parameters.Q.Y!),
        };

        var jwkJson = JsonSerializer.Serialize(jwk);
        PublicKeyBase64 = Base64UrlEncode(Encoding.UTF8.GetBytes(jwkJson));
        DeviceId = "desktop-" + DeriveDeviceId(PublicKeyBase64);
    }

    public string Sign(string payload)
    {
        if (_ecdsa == null) throw new InvalidOperationException("Identity not initialized.");
        var data = Encoding.UTF8.GetBytes(payload);
        var signature = _ecdsa.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return Base64UrlEncode(signature);
    }

    private static string DeriveDeviceId(string publicKeyBase64)
    {
        var raw = Base64UrlDecode(publicKeyBase64);
        var hash = new byte[32];
        for (var i = 0; i < raw.Length; i++)
        {
            hash[i % 32] ^= raw[i];
            hash[i % 32] = (byte)((hash[i % 32] * 31 + raw[i]) & 0xff);
        }
        return Base64UrlEncode(hash).Substring(0, 22);
    }

    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    private static byte[] Base64UrlDecode(string input)
    {
        var s = input.Replace('-', '+').Replace('_', '/');
        var rem = s.Length % 4;
        if (rem == 2) s += "==";
        else if (rem == 3) s += "=";
        return Convert.FromBase64String(s);
    }

    public void Dispose()
    {
        _ecdsa?.Dispose();
        _ecdsa = null;
    }
}
