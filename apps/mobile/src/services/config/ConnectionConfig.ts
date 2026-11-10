/**
 * ConnectionConfig.ts
 *
 * Single source of truth for the signaling server endpoint.
 * Host is user-configurable (desktop LAN IP on physical devices;
 * localhost only for emulator/simulator).
 */

import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'ojowacam.signaling.host';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8080;

export class ConnectionConfig {
  private host = DEFAULT_HOST;
  private port = DEFAULT_PORT;
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored && stored.trim()) {
        this.host = stored.trim();
      }
    } catch {
      // Keep default if storage unavailable.
    }
    this.loaded = true;
  }

  getHost(): string {
    return this.host;
  }

  getPort(): number {
    return this.port;
  }

  getSignalingUrl(): string {
    const host = this.host || DEFAULT_HOST;
    return `ws://${host}:${this.port}`;
  }

  isDefaultLocalhost(): boolean {
    return this.host === DEFAULT_HOST || this.host === '127.0.0.1' || this.host === '::1';
  }

  async setHost(host: string): Promise<string> {
    const trimmed = host.trim();
    if (!trimmed) {
      throw new Error('Host cannot be empty');
    }
    // Strip accidental scheme/path if user pasted a full URL.
    let normalized = trimmed
      .replace(/^wss?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '');
    if (!normalized) {
      throw new Error('Invalid host');
    }
    this.host = normalized;
    this.loaded = true;
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, normalized);
    } catch {
      // In-memory only if storage fails.
    }
    return this.getSignalingUrl();
  }

  async resetHost(): Promise<string> {
    this.host = DEFAULT_HOST;
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch {
      // ignore
    }
    return this.getSignalingUrl();
  }
}

export const connectionConfig = new ConnectionConfig();
