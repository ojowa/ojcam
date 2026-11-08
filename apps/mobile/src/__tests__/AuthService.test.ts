/**
 * AuthService.test.ts
 * Unit tests for the AuthService security module.
 */

import { authService } from '../services/security/AuthService';
import { deviceIdentity } from '../services/security/DeviceIdentity';
import { pairingService } from '../services/security/PairingService';
import { setStorageAdapter } from '../services/security/DeviceIdentity';

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
  (authService as any).session = null;
  (pairingService as any).pendingPairings.clear();
});

describe('AuthService', () => {
  beforeEach(async () => {
    await deviceIdentity.initialize();
  });

  it('should establish a session after pairing', async () => {
    const sessionToken = 'test-session-token-123';
    const session = await authService.establishSession(sessionToken);
    expect(session.token).toBe(sessionToken);
    expect(session.deviceId).toBe(deviceIdentity.getDeviceId());
    expect(session.authenticated).toBe(true);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it('should return null session when not authenticated', () => {
    expect(authService.getSession()).toBeNull();
    expect(authService.isAuthenticated()).toBe(false);
  });

  it('should get auth token after establishing session', async () => {
    await authService.establishSession('test-token');
    expect(authService.getAuthToken()).toBe('test-token');
  });

  it('should expire session', async () => {
    await authService.establishSession('test-token');
    expect(authService.isAuthenticated()).toBe(true);
    authService.expireSession();
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getSession()).toBeNull();
  });

  it('should return session TTL', async () => {
    await authService.establishSession('test-token');
    const ttl = authService.getSessionTTL();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600); // 10 minutes
  });

  it('should authenticate a message with session info', async () => {
    await authService.establishSession('test-token');
    const message = { type: 'OFFER', sdp: 'v=0...' };
    const authenticated = await authService.authenticateMessage(message);
    expect(authenticated.authenticated).toBe(true);
    expect(authenticated.deviceId).toBe(deviceIdentity.getDeviceId());
    expect(authenticated.sessionToken).toBe('test-token');
    expect(authenticated.signature).toBeDefined();
  });

  it('should return unauthenticated message when no session', async () => {
    const message = { type: 'OFFER', sdp: 'v=0...' };
    const authenticated = await authService.authenticateMessage(message);
    expect(authenticated.authenticated).toBe(false);
  });

  it('should validate incoming messages with valid session', async () => {
    await authService.establishSession('test-token');
    const message = { type: 'ANSWER', sessionToken: 'test-token' };
    const result = await authService.validateIncomingMessage(message);
    expect(result.valid).toBe(true);
  });

  it('should reject messages with wrong session token', async () => {
    await authService.establishSession('test-token');
    const message = { type: 'ANSWER', sessionToken: 'wrong-token' };
    const result = await authService.validateIncomingMessage(message);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('should report not paired when no session', () => {
    expect(authService.isPaired()).toBe(false);
  });
});
