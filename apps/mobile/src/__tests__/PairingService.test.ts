/**
 * PairingService.test.ts
 * Unit tests for the PairingService security module.
 */

import { pairingService } from '../services/security/PairingService';
import { deviceIdentity } from '../services/security/DeviceIdentity';
import { setStorageAdapter } from '../services/security/DeviceIdentity';
import { defaultPairingRateLimiter } from '../services/security/RateLimiter';

const mockStorage = new Map<string, string>();

beforeEach(() => {
  mockStorage.clear();
  setStorageAdapter({
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      mockStorage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockStorage.delete(key);
      return Promise.resolve();
    }),
  });
  // Reset pairing service state
  (pairingService as any).pendingPairings.clear();
});

describe('PairingService', () => {
  beforeEach(async () => {
    await deviceIdentity.initialize();
    defaultPairingRateLimiter.reset(deviceIdentity.getDeviceId());
  });

  it('should generate a pairing code and QR payload', async () => {
    const result = await pairingService.generatePairingCode('Test Device');
    expect(result.code.code).toMatch(/^\d{6}$/);
    expect(result.code.ttlSeconds).toBe(600); // 10 minutes
    expect(result.code.expiresAt).toBeGreaterThan(Date.now());
    expect(result.qrPayload.deviceId).toBe(deviceIdentity.getDeviceId());
    expect(result.qrPayload.deviceName).toBe('Test Device');
    expect(result.qrPayload.publicKey).toBeDefined();
    expect(result.qrPayload.signature).toBeDefined();
  });

  it('should validate a pairing code as valid before expiry', async () => {
    const result = await pairingService.generatePairingCode('Test Device');
    expect(pairingService.isCodeValid(result.code.code)).toBe(true);
    expect(pairingService.getCodeTTL(result.code.code)).toBeGreaterThan(0);
  });

  it('should cancel a pairing code', async () => {
    const result = await pairingService.generatePairingCode('Test Device');
    pairingService.cancelPairing(result.code.code);
    expect(pairingService.isCodeValid(result.code.code)).toBe(false);
  });

  it('should handle a successful pairing response', async () => {
    const result = await pairingService.generatePairingCode('Test Device');
    const sessionToken = 'test-session-token';

    const pairingResult = await pairingService.handlePairingResponse({
      deviceId: deviceIdentity.getDeviceId(),
      pairingCode: result.code.code,
      sessionToken,
      success: true,
    });

    expect(pairingResult.success).toBe(true);
    expect(pairingResult.sessionToken).toBe(sessionToken);
  });

  it('should reject a pairing response with no pending pairing', async () => {
    const result = await pairingService.handlePairingResponse({
      deviceId: 'unknown-device',
      pairingCode: 'unknown-code',
      success: true,
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('No matching pending pairing');
  });

  it('should reject an expired pairing code', async () => {
    const result = await pairingService.generatePairingCode('Test Device');
    // Manually expire the pairing
    const pairing = (pairingService as any).pendingPairings.get(result.code.code);
    pairing.expiresAt = Date.now() - 1000;

    const pairingResult = await pairingService.handlePairingResponse({
      deviceId: deviceIdentity.getDeviceId(),
      pairingCode: result.code.code,
      success: true,
    });
    expect(pairingResult.success).toBe(false);
    expect(pairingResult.errorMessage).toContain('expired');
  });

  it('should reject a failed pairing response', async () => {
    const generated = await pairingService.generatePairingCode('Test Device');
    const result = await pairingService.handlePairingResponse({
      deviceId: deviceIdentity.getDeviceId(),
      pairingCode: generated.code.code,
      success: false,
      errorMessage: 'Desktop rejected pairing',
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Desktop rejected pairing');
  });

  it('should get pending pairings', async () => {
    await pairingService.generatePairingCode('Test Device');
    const pending = pairingService.getPendingPairings();
    expect(pending.length).toBe(1);
    expect(pending[0].resolved).toBe(false);
  });
});
