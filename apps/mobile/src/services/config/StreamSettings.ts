/**
 * StreamSettings.ts
 *
 * Persisted streaming preferences: resolution, framerate, microphone, and
 * autofocus. CameraScreen feeds these into startStreaming; bitrate is
 * derived from resolution x fps instead of being hardcoded.
 */

import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'ojowacam.stream.settings';

export type StreamResolution = '3840x2160' | '1920x1080' | '1280x720';
export type ResolutionLabel = '4K' | '1080p' | '720p';
export type StreamFps = 30 | 60;

interface StoredSettings {
  resolution: StreamResolution;
  fps: StreamFps;
  audioEnabled: boolean;
  autoFocus: boolean;
  /** Wireless Mic: platform noise suppressor on/off. */
  noiseSuppression: boolean;
  /** Wireless Mic: linear mic gain, 1.0 (unity) .. 4.0. */
  gainBoost: number;
}

const VALID_RESOLUTIONS: readonly StreamResolution[] = ['3840x2160', '1920x1080', '1280x720'];

const DEFAULTS: StoredSettings = {
  resolution: '3840x2160',
  fps: 30,
  audioEnabled: true,
  autoFocus: true,
  noiseSuppression: true,
  gainBoost: 1.0,
};

const MIN_GAIN = 1.0;
const MAX_GAIN = 4.0;

export class StreamSettings {
  private settings: StoredSettings = { ...DEFAULTS };
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored && stored.trim()) {
        const parsed = JSON.parse(stored) as Partial<StoredSettings>;
        if (parsed.resolution && VALID_RESOLUTIONS.includes(parsed.resolution)) {
          this.settings.resolution = parsed.resolution;
        }
        if (parsed.fps === 30 || parsed.fps === 60) {
          this.settings.fps = parsed.fps;
        }
        if (typeof parsed.audioEnabled === 'boolean') {
          this.settings.audioEnabled = parsed.audioEnabled;
        }
        if (typeof parsed.autoFocus === 'boolean') {
          this.settings.autoFocus = parsed.autoFocus;
        }
        if (typeof parsed.noiseSuppression === 'boolean') {
          this.settings.noiseSuppression = parsed.noiseSuppression;
        }
        if (typeof parsed.gainBoost === 'number' && Number.isFinite(parsed.gainBoost)) {
          this.settings.gainBoost = Math.min(MAX_GAIN, Math.max(MIN_GAIN, parsed.gainBoost));
        }
      }
    } catch {
      // Keep defaults if storage unavailable.
    }
    this.loaded = true;
  }

  getResolution(): StreamResolution {
    return this.settings.resolution;
  }

  getFps(): StreamFps {
    return this.settings.fps;
  }

  isAudioEnabled(): boolean {
    return this.settings.audioEnabled;
  }

  isAutoFocus(): boolean {
    return this.settings.autoFocus;
  }

  isNoiseSuppressionEnabled(): boolean {
    return this.settings.noiseSuppression;
  }

  getGainBoost(): number {
    return this.settings.gainBoost;
  }

  getResolutionLabel(): ResolutionLabel {
    switch (this.settings.resolution) {
      case '3840x2160':
        return '4K';
      case '1920x1080':
        return '1080p';
      case '1280x720':
        return '720p';
    }
  }

  /** Bitrate scaled by resolution and framerate (pending bitrate-scaling work). */
  getBitrate(): number {
    const highFps = this.settings.fps > 30;
    switch (this.settings.resolution) {
      case '3840x2160':
        return highFps ? 32000000 : 20000000;
      case '1920x1080':
        return highFps ? 12000000 : 8000000;
      case '1280x720':
        return highFps ? 6000000 : 4000000;
    }
  }

  private async persist(): Promise<void> {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // In-memory only if storage fails.
    }
  }

  async setResolution(resolution: StreamResolution): Promise<void> {
    if (!VALID_RESOLUTIONS.includes(resolution)) return;
    this.settings.resolution = resolution;
    this.loaded = true;
    await this.persist();
  }

  async setFps(fps: StreamFps): Promise<void> {
    if (fps !== 30 && fps !== 60) return;
    this.settings.fps = fps;
    this.loaded = true;
    await this.persist();
  }

  async setAudioEnabled(enabled: boolean): Promise<void> {
    this.settings.audioEnabled = enabled;
    this.loaded = true;
    await this.persist();
  }

  async setAutoFocus(enabled: boolean): Promise<void> {
    this.settings.autoFocus = enabled;
    this.loaded = true;
    await this.persist();
  }

  async setNoiseSuppression(enabled: boolean): Promise<void> {
    this.settings.noiseSuppression = enabled;
    this.loaded = true;
    await this.persist();
  }

  async setGainBoost(gain: number): Promise<void> {
    if (!Number.isFinite(gain)) return;
    this.settings.gainBoost = Math.min(MAX_GAIN, Math.max(MIN_GAIN, gain));
    this.loaded = true;
    await this.persist();
  }
}

export const streamSettings = new StreamSettings();
