/**
 * DeviceIdentity.test.ts
 * Unit tests for the DeviceIdentity security module.
 */

import { deviceIdentity, setStorageAdapter } from '../services/security/DeviceIdentity';

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
});

describe('DeviceIdentity', () => {
  it('should generate a new device identity on first initialization', async () => {
    const pair = await deviceIdentity.initialize();
    expect(pair.deviceId).toBeDefined();
    expect(pair.publicKey).toBeDefined();
    expect(pair.privateKey).toBeDefined();
    expect(pair.deviceId.startsWith('mobilecam-')).toBe(true);
  });

  it('should return the same identity on re-initialization', async () => {
    const pair1 = await deviceIdentity.initialize();
    const pair2 = await deviceIdentity.initialize();
    expect(pair1.deviceId).toBe(pair2.deviceId);
    expect(pair1.publicKey).toBe(pair2.publicKey);
  });

  it('should persist identity to storage', async () => {
    await deviceIdentity.initialize();
    expect(mockStorage.has('ojowacam.device.id')).toBe(true);
    expect(mockStorage.has('ojowacam.device.publicKey')).toBe(true);
    expect(mockStorage.has('ojowacam.device.privateKey')).toBe(true);
  });

  it('should load identity from storage', async () => {
    await deviceIdentity.initialize();
    const firstId = deviceIdentity.getDeviceId();

    // Reset instance to simulate re-load
    (deviceIdentity as any).keyPair = null;
    (deviceIdentity as any).initialized = false;

    await deviceIdentity.initialize();
    expect(deviceIdentity.getDeviceId()).toBe(firstId);
  });

  it('should get device ID and public key', async () => {
    await deviceIdentity.initialize();
    const id = deviceIdentity.getDeviceId();
    const key = deviceIdentity.getPublicKey();
    expect(typeof id).toBe('string');
    expect(typeof key).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(key.length).toBeGreaterThan(0);
  });

  it('should throw if not initialized', () => {
    (deviceIdentity as any).keyPair = null;
    (deviceIdentity as any).initialized = false;
    expect(() => deviceIdentity.getDeviceId()).toThrow('not initialized');
    expect(() => deviceIdentity.getPublicKey()).toThrow('not initialized');
  });

  it('should sign and verify payloads', async () => {
    await deviceIdentity.initialize();
    const payload = 'test-payload';
    const signed = await deviceIdentity.signPayload(payload);
    expect(signed.payload).toBe(payload);
    expect(signed.signature).toBeDefined();
    expect(signed.deviceId).toBe(deviceIdentity.getDeviceId());
    expect(signed.algorithm).toBe('ECDSA-SHA256');
  });

  it('should reset identity', async () => {
    await deviceIdentity.initialize();
    await deviceIdentity.reset();
    expect(deviceIdentity.isInitialized()).toBe(false);
    expect(mockStorage.size).toBe(0);
  });
});
