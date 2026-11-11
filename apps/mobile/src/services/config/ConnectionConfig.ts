/**
 * ConnectionConfig.ts
 *
 * Single source of truth for the signaling endpoint. The phone hosts the
 * WebSocket server, so only the listen port is configurable; OBS dials in
 * at the phone's LAN IP (shown in the UI).
 */

import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'ojowacam.signaling.port';
const DEFAULT_PORT = 8765;
const DEFAULT_HOST = '0.0.0.0';

export class ConnectionConfig {
  private port = DEFAULT_PORT;
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored && stored.trim()) {
        const parsed = parseInt(stored.trim(), 10);
        if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
          this.port = parsed;
        }
      }
    } catch {
      // Keep default if storage unavailable.
    }
    this.loaded = true;
  }

  getPort(): number {
    return this.port;
  }

  getSignalingUrl(): string {
    return `ws://${DEFAULT_HOST}:${this.port}`;
  }

  isDefaultPort(): boolean {
    return this.port === DEFAULT_PORT;
  }

  async setPort(port: number): Promise<string> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('Port must be an integer between 1 and 65535');
    }
    this.port = port;
    this.loaded = true;
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, String(port));
    } catch {
      // In-memory only if storage fails.
    }
    return this.getSignalingUrl();
  }

  async resetPort(): Promise<string> {
    this.port = DEFAULT_PORT;
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch {
      // ignore
    }
    return this.getSignalingUrl();
  }
}

export const connectionConfig = new ConnectionConfig();
