/**
 * StreamSettings.test.ts
 * Unit tests for persisted stream preferences and bitrate scaling.
 */

import * as SecureStore from 'expo-secure-store';
import { StreamSettings, type StreamResolution, type StreamFps } from '../services/config/StreamSettings';

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;

describe('StreamSettings', () => {
  beforeEach(() => {
    getItemAsync.mockReset();
    setItemAsync.mockReset();
    getItemAsync.mockResolvedValue(null);
    setItemAsync.mockResolvedValue(undefined);
  });

  it('defaults to 4K at 30fps with audio and autofocus on', async () => {
    const s = new StreamSettings();
    await s.load();
    expect(s.getResolution()).toBe('3840x2160');
    expect(s.getResolutionLabel()).toBe('4K');
    expect(s.getFps()).toBe(30);
    expect(s.isAudioEnabled()).toBe(true);
    expect(s.isAutoFocus()).toBe(true);
    expect(s.getBitrate()).toBe(20000000);
  });

  it('scales bitrate by resolution and framerate', async () => {
    const table: Array<[StreamResolution, StreamFps, number]> = [
      ['1280x720', 30, 4000000],
      ['1280x720', 60, 6000000],
      ['1920x1080', 30, 8000000],
      ['1920x1080', 60, 12000000],
      ['3840x2160', 30, 20000000],
      ['3840x2160', 60, 32000000],
    ];
    for (const [resolution, fps, bitrate] of table) {
      const s = new StreamSettings();
      await s.setResolution(resolution);
      await s.setFps(fps);
      expect(s.getBitrate()).toBe(bitrate);
    }
  });

  it('persists changes and reloads them', async () => {
    const s = new StreamSettings();
    await s.load();
    await s.setResolution('1920x1080');
    await s.setFps(60);
    await s.setAudioEnabled(false);
    await s.setAutoFocus(false);

    expect(setItemAsync).toHaveBeenCalledTimes(4);
    const stored = setItemAsync.mock.calls[setItemAsync.mock.calls.length - 1][1] as string;
    expect(JSON.parse(stored)).toMatchObject({
      resolution: '1920x1080',
      fps: 60,
      audioEnabled: false,
      autoFocus: false,
    });

    getItemAsync.mockResolvedValue(stored);
    const reloaded = new StreamSettings();
    await reloaded.load();
    expect(reloaded.getResolution()).toBe('1920x1080');
    expect(reloaded.getResolutionLabel()).toBe('1080p');
    expect(reloaded.getFps()).toBe(60);
    expect(reloaded.isAudioEnabled()).toBe(false);
    expect(reloaded.isAutoFocus()).toBe(false);
    expect(reloaded.getBitrate()).toBe(12000000);
  });

  it('ignores corrupt or invalid stored values', async () => {
    getItemAsync.mockResolvedValue('not-json{{');
    const s = new StreamSettings();
    await s.load();
    expect(s.getResolution()).toBe('3840x2160');
    expect(s.getFps()).toBe(30);

    getItemAsync.mockResolvedValue(JSON.stringify({ resolution: '640x480', fps: 24 }));
    const s2 = new StreamSettings();
    await s2.load();
    expect(s2.getResolution()).toBe('3840x2160');
    expect(s2.getFps()).toBe(30);
  });
});
