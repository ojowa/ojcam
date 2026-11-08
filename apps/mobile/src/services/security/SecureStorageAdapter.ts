/**
 * SecureStorageAdapter.ts
 * 
 * Connects DeviceIdentity to expo-secure-store for platform-backed secure
 * key storage (Keychain on iOS, EncryptedSharedPreferences/Keystore on Android).
 * 
 * Call initializeSecureStorage() during app startup before using deviceIdentity.
 */

import * as SecureStore from 'expo-secure-store';
import { setStorageAdapter } from './DeviceIdentity';

/**
 * Initialize the secure storage adapter with expo-secure-store.
 * This should be called once during app startup (e.g. in App.tsx or
 * StreamingService.initialize()) before any deviceIdentity operations.
 */
export function initializeSecureStorage(): void {
  setStorageAdapter({
    async getItem(key: string): Promise<string | null> {
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    },
    async setItem(key: string, value: string): Promise<void> {
      await SecureStore.setItemAsync(key, value);
    },
    async removeItem(key: string): Promise<void> {
      await SecureStore.deleteItemAsync(key);
    },
  });
}
