/**
 * StreamingService.test.ts
 * Unit tests for the StreamingService module.
 */

import { StreamingService, defaultStreamingConfig } from '../services/StreamingService';
import { signalingService } from '../services/signaling/SignalingService';
import { authService } from '../services/security/AuthService';
import { deviceIdentity } from '../services/security/DeviceIdentity';
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
  // Reset signaling state
  (signalingService as any).transport = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    setUrl: jest.fn(),
    send: jest.fn().mockReturnValue(true),
    sendReliable: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    isListening: jest.fn().mockReturnValue(false),
    getState: jest.fn().mockReturnValue({ connected: false, reconnecting: false, attemptCount: 0, queuedMessages: 0 }),
  };
});

describe('StreamingService', () => {
  beforeEach(async () => {
    await deviceIdentity.initialize();
  });

  it('should initialize successfully', async () => {
    const service = new StreamingService();
    const result = await service.initialize();
    expect(result).toBe(true);
    expect(service.getState().isAuthenticated).toBe(false);
  });

  it('should have correct default config', () => {
    const service = new StreamingService();
    expect(service.getConfig().resolution).toBe('3840x2160');
    expect(service.getConfig().fps).toBe(30);
    expect(service.getConfig().bitrate).toBe(8000000);
    expect(service.getConfig().codec).toBe('H264');
  });

  it('should calculate width and height from resolution', () => {
    const service = new StreamingService();
    expect(service.width).toBe(3840);
    expect(service.height).toBe(2160);

    service.getConfig(); // Just to verify config access works
  });

  it('should not start streaming when not authenticated and autoPair is false', async () => {
    const service = new StreamingService({ ...defaultStreamingConfig, autoPair: false });
    await service.initialize();
    const result = await service.startStreaming('camera-0', {
      resolution: '3840x2160',
      fps: 30,
      bitrate: 8000000,
      codec: 'H264',
    });
    expect(result).toBe(false);
    expect(service.getState().error).toContain('Session required');
  });

  it('should report streaming state correctly', () => {
    const service = new StreamingService();
    expect(service.getIsStreaming()).toBe(false);
    expect(service.getCurrentCameraId()).toBeNull();
  });

  it('should track connection state', async () => {
    const service = new StreamingService();
    const state = service.getState();
    expect(state.isConnected).toBeDefined();
    expect(state.isAuthenticated).toBeDefined();
    expect(state.error).toBeNull();
  });
});

