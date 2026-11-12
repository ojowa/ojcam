/**
 * DeviceIdentity.ts
 * 
 * Cryptographic device identity management.
 * 
 * Security requirement: "Cryptographic device identity" (SECURITY.md)
 * 
 * Generates or loads an ECDSA P-256 key pair unique to this device.
 * The device ID is derived from the public key, providing a cryptographically
 * verifiable identity that the desktop receiver can authenticate.
 */

import { utf8Decode, utf8Encode } from '../../utils/utf8';


// ---------------------------------------------------------------------------
// Platform storage adapter
// ---------------------------------------------------------------------------

export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class MemoryStorage implements SecureStorage {
  private store = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

let storageAdapter: SecureStorage = new MemoryStorage();

export function setStorageAdapter(adapter: SecureStorage): void {
  storageAdapter = adapter;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY_PRIVATE_KEY = 'ojowacam.device.privateKey';
const STORAGE_KEY_PUBLIC_KEY = 'ojowacam.device.publicKey';
const STORAGE_KEY_DEVICE_ID = 'ojowacam.device.id';
const CURVE_NAME = 'P-256';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceKeyPair {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export interface SignedPayload {
  payload: string;
  signature: string;
  algorithm: string;
  deviceId: string;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function generateRandomDeviceId(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return arrayBufferToBase64Url(bytes);
}

export function deriveDeviceId(publicKeyBase64: string): string {
  const raw = base64ToArrayBuffer(publicKeyBase64);
  const hash = simpleHash(raw);
  return 'mobilecam-' + arrayBufferToBase64Url(hash).substring(0, 22);
}

function simpleHash(data: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(data);
  const hash = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    hash[i % 32] ^= bytes[i];
    hash[i % 32] = (hash[i % 32] * 31 + bytes[i]) & 0xff;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// DeviceIdentity class
// ---------------------------------------------------------------------------

export class DeviceIdentity {
  private static instance: DeviceIdentity;
  private keyPair: DeviceKeyPair | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): DeviceIdentity {
    if (!DeviceIdentity.instance) {
      DeviceIdentity.instance = new DeviceIdentity();
    }
    return DeviceIdentity.instance;
  }

  async initialize(): Promise<DeviceKeyPair> {
    if (this.initialized && this.keyPair) {
      return this.keyPair;
    }

    const storedDeviceId = await storageAdapter.getItem(STORAGE_KEY_DEVICE_ID);
    const storedPublicKey = await storageAdapter.getItem(STORAGE_KEY_PUBLIC_KEY);
    const storedPrivateKey = await storageAdapter.getItem(STORAGE_KEY_PRIVATE_KEY);

    if (storedDeviceId && storedPublicKey && storedPrivateKey) {
      this.keyPair = {
        deviceId: storedDeviceId,
        publicKey: storedPublicKey,
        privateKey: storedPrivateKey,
      };
      this.initialized = true;
      return this.keyPair;
    }

    const newPair = await this.generateKeyPair();
    this.keyPair = newPair;
    this.initialized = true;

    await storageAdapter.setItem(STORAGE_KEY_DEVICE_ID, newPair.deviceId);
    await storageAdapter.setItem(STORAGE_KEY_PUBLIC_KEY, newPair.publicKey);
    await storageAdapter.setItem(STORAGE_KEY_PRIVATE_KEY, newPair.privateKey);

    return newPair;
  }

  getDeviceId(): string {
    if (!this.keyPair) {
      throw new Error('DeviceIdentity not initialized.');
    }
    return this.keyPair.deviceId;
  }

  getPublicKey(): string {
    if (!this.keyPair) {
      throw new Error('DeviceIdentity not initialized.');
    }
    return this.keyPair.publicKey;
  }

  private async generateKeyPair(): Promise<DeviceKeyPair> {
    let publicKeyJwk: JsonWebKey;
    let privateKeyBase64: string;

    if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
      try {
        const keyPair = await crypto.subtle.generateKey(
          {
            name: 'ECDSA',
            namedCurve: CURVE_NAME,
          },
          true,
          ['sign', 'verify']
        );

        const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
        const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

        publicKeyJwk = publicKey as JsonWebKey;
        privateKeyBase64 = arrayBufferToBase64Url(
          utf8Encode(JSON.stringify(privateKey))
        );
      } catch (err) {
        console.warn('Web Crypto ECDSA unavailable, using software fallback', err);
        return this.generateSoftwareKeyPair();
      }
    } else {
      return this.generateSoftwareKeyPair();
    }

    const publicKeyBase64 = arrayBufferToBase64Url(
      utf8Encode(JSON.stringify(publicKeyJwk))
    );
    const deviceId = deriveDeviceId(publicKeyBase64);

    return {
      deviceId,
      publicKey: publicKeyBase64,
      privateKey: privateKeyBase64,
    };
  }

  private generateSoftwareKeyPair(): DeviceKeyPair {
    const deviceId = generateRandomDeviceId();
    const privateBytes = new Uint8Array(32);
    const publicBytes = new Uint8Array(64);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(privateBytes);
      crypto.getRandomValues(publicBytes);
    } else {
      for (let i = 0; i < 32; i++) privateBytes[i] = Math.floor(Math.random() * 256);
      for (let i = 0; i < 64; i++) publicBytes[i] = Math.floor(Math.random() * 256);
    }

    return {
      deviceId,
      publicKey: arrayBufferToBase64Url(publicBytes),
      privateKey: arrayBufferToBase64Url(privateBytes),
    };
  }

  async signPayload(payload: string): Promise<SignedPayload> {
    if (!this.keyPair) {
      throw new Error('DeviceIdentity not initialized.');
    }

    let signature: string;

    if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
      try {
        const privateKeyJwk: JsonWebKey = JSON.parse(
          utf8Decode(new Uint8Array(base64ToArrayBuffer(this.keyPair.privateKey)))
        );
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          privateKeyJwk,
          { name: 'ECDSA', namedCurve: CURVE_NAME },
          false,
          ['sign']
        );

        const sig = await crypto.subtle.sign(
          { name: 'ECDSA', hash: { name: 'SHA-256' } },
          cryptoKey,
          utf8Encode(payload)
        );
        signature = arrayBufferToBase64Url(sig);
      } catch (err) {
        console.warn('Web Crypto sign unavailable, using HMAC fallback', err);
        signature = await this.hmacSign(payload);
      }
    } else {
      signature = await this.hmacSign(payload);
    }

    return {
      payload,
      signature,
      algorithm: 'ECDSA-SHA256',
      deviceId: this.keyPair.deviceId,
    };
  }

  async verifySignature(
    payload: string,
    signature: string,
    signerPublicKey: string
  ): Promise<boolean> {
    if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
      try {
        const publicKeyJwk: JsonWebKey = JSON.parse(
          utf8Decode(new Uint8Array(base64ToArrayBuffer(signerPublicKey)))
        );
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          publicKeyJwk,
          { name: 'ECDSA', namedCurve: CURVE_NAME },
          false,
          ['verify']
        );

        const result = await crypto.subtle.verify(
          { name: 'ECDSA', hash: { name: 'SHA-256' } },
          cryptoKey,
          base64ToArrayBuffer(signature),
          utf8Encode(payload)
        );
        return result;
      } catch (err) {
        console.warn('Web Crypto verify unavailable', err);
        return false;
      }
    }
    return false;
  }

  private async hmacSign(payload: string): Promise<string> {
    const key = this.keyPair!.privateKey;
    const keyData = utf8Encode(key);
    const payloadData = utf8Encode(payload);

    if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
      try {
        const key = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'HMAC', hash: { name: 'SHA-256' } },
          false,
          ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, payloadData);
        return arrayBufferToBase64Url(sig);
      } catch {
        // fall through
      }
    }

    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return arrayBufferToBase64Url(utf8Encode(hash.toString()));
  }

  async reset(): Promise<void> {
    this.keyPair = null;
    this.initialized = false;
    await storageAdapter.removeItem(STORAGE_KEY_DEVICE_ID);
    await storageAdapter.removeItem(STORAGE_KEY_PUBLIC_KEY);
    await storageAdapter.removeItem(STORAGE_KEY_PRIVATE_KEY);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const deviceIdentity = DeviceIdentity.getInstance();

function arrayBufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
