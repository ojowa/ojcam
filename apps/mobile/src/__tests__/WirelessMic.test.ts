import {
  SignalingServer,
  encodeServerFrameBytes,
} from '../services/signaling/SignalingServer';
import { streamSettings } from '../services/config/StreamSettings';
import { streamingService } from '../services/StreamingService';
import { atobPolyfill, btoaPolyfill } from '../utils/polyfills';

describe('Wireless Mic PCM framing (opcode 0x2)', () => {
  it('encodes an unmasked binary server frame', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const frame = encodeServerFrameBytes(payload, 0x2);
    expect(frame[0]).toBe(0x82); // FIN + opcode 0x2
    expect(frame[1]).toBe(3);
    expect(Array.from(frame.slice(2))).toEqual([1, 2, 3]);
  });

  it('uses opcode 0x2 by default for raw byte frames', () => {
    const frame = encodeServerFrameBytes(new Uint8Array(4));
    expect(frame[0] & 0x0f).toBe(0x2);
  });

  it('encodes 16-bit lengths for typical PCM chunk sizes', () => {
    const payload = new Uint8Array(4000);
    const frame = encodeServerFrameBytes(payload);
    expect(frame[1]).toBe(126);
    expect((frame[2] << 8) | frame[3]).toBe(4000);
    expect(frame.length).toBe(4 + 4000);
  });

  it('drops audio frames when no peer is ready instead of queueing them', () => {
    const server = new SignalingServer();
    expect(server.sendBinary(new Uint8Array([0, 1]))).toBe(false);
    expect(server.getState().queuedMessages).toBe(0);
  });

  it('round-trips PCM bytes through the base64 bridge encoding', () => {
    const bytes = new Uint8Array(512);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const decoded = atobPolyfill(btoaPolyfill(binary));
    expect(decoded.length).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      expect(decoded.charCodeAt(i)).toBe(bytes[i]);
    }
  });
});

describe('Wireless Mic settings', () => {
  it('defaults to noise suppression on at unity gain', async () => {
    await streamSettings.load();
    expect(streamSettings.isNoiseSuppressionEnabled()).toBe(true);
    expect(streamSettings.getGainBoost()).toBe(1.0);
  });

  it('clamps gain boosts to the 1.0..4.0 range and persists', async () => {
    await streamSettings.setGainBoost(99);
    expect(streamSettings.getGainBoost()).toBe(4.0);
    await streamSettings.setGainBoost(0.2);
    expect(streamSettings.getGainBoost()).toBe(1.0);
    await streamSettings.setGainBoost(2.5);
    expect(streamSettings.getGainBoost()).toBe(2.5);
  });

  it('persists noise suppression changes', async () => {
    await streamSettings.setNoiseSuppression(false);
    expect(streamSettings.isNoiseSuppressionEnabled()).toBe(false);
    await streamSettings.setNoiseSuppression(true);
    expect(streamSettings.isNoiseSuppressionEnabled()).toBe(true);
  });
});

describe('Wireless Mic broadcast service', () => {
  it('fails honestly on non-Android platforms', async () => {
    const started = await streamingService.startAudioBroadcast();
    expect(started).toBe(false);
    expect(streamingService.getState().error).toMatch(/Android/);
    expect(streamingService.getIsAudioBroadcasting()).toBe(false);
  });

  it('tracks mute state without fabricating audio', () => {
    expect(streamingService.getIsAudioMuted()).toBe(false);
    streamingService.setAudioMuted(true);
    expect(streamingService.getIsAudioMuted()).toBe(true);
    streamingService.setAudioMuted(false);
    expect(streamingService.getIsAudioMuted()).toBe(false);
  });

  it('exposes broadcast state in the streaming state', () => {
    expect(streamingService.getState().isAudioBroadcasting).toBe(false);
    expect(streamingService.getIsAudioBroadcasting()).toBe(false);
  });
});
