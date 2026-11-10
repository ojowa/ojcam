/**
 * PairingService.ts
 * 
 * QR-based pairing with short-lived tokens.
 * 
 * Security requirement: "QR-based pairing: Short-lived pairing tokens" (SECURITY.md)
 * 
 * Generates 6-digit pairing codes and QR payloads that the desktop receiver
 * can scan to initiate a secure pairing session. Pairing codes expire after
 * a configurable TTL (default 10 minutes, matching appsettings.json).
 */

import { deviceIdentity } from './DeviceIdentity';
import { defaultPairingRateLimiter } from './RateLimiter';

export interface PairingCode {
  code: string;
  expiresAt: number;
  ttlSeconds: number;
}

export interface PairingQRPayload {
  deviceId: string;
  deviceName: string;
  publicKey: string;
  pairingCode: string;
  expiresAt: number;
  signature: string;
}

export interface PendingPairing {
  code: string;
  deviceId: string;
  expiresAt: number;
  sessionToken?: string;
  resolved: boolean;
}

export interface PairingResult {
  success: boolean;
  sessionToken?: string;
  errorMessage?: string;
}

export interface PairingConfig {
  codeLength: number;
  tokenExpirationMinutes: number;
  maxAttempts: number;
}

export const defaultPairingConfig: PairingConfig = {
  codeLength: 6,
  tokenExpirationMinutes: 10,
  maxAttempts: 5,
};

export class PairingService {
  private config: PairingConfig;
  private pendingPairings: Map<string, PendingPairing> = new Map();
  private onPairingCodeGenerated?: (code: PairingCode) => void;
  private onPairingCompleted?: (result: PairingResult) => void;

  constructor(config: PairingConfig = defaultPairingConfig) {
    this.config = config;
    setInterval(() => this.cleanup(), 60 * 1000).unref?.();
  }

  setOnPairingCodeGenerated(callback: (code: PairingCode) => void): void {
    this.onPairingCodeGenerated = callback;
  }

  setOnPairingCompleted(callback: (result: PairingResult) => void): void {
    this.onPairingCompleted = callback;
  }

  async generatePairingCode(deviceName: string = 'Ojowacam Mobile'): Promise<{
    code: PairingCode;
    qrPayload: PairingQRPayload;
  }> {
    const deviceId = deviceIdentity.getDeviceId();
    const publicKey = deviceIdentity.getPublicKey();

    const rateResult = defaultPairingRateLimiter.check(deviceId);
    if (!rateResult.allowed) {
      throw new Error(
        `Pairing rate limited. Try again in ${Math.max(
          0,
          (rateResult.lockoutUntil || rateResult.resetAt) - Date.now()
        )} ms`
      );
    }

    const code = generatePairingCode(this.config.codeLength);
    const now = Date.now();
    const expiresAt = now + this.config.tokenExpirationMinutes * 60 * 1000;
    const ttlSeconds = this.config.tokenExpirationMinutes * 60;

    const pairingCode: PairingCode = {
      code,
      expiresAt,
      ttlSeconds,
    };

    this.pendingPairings.set(code, {
      code,
      deviceId,
      expiresAt,
      resolved: false,
    });

    const qrPayloadData = {
      deviceId,
      deviceName,
      publicKey,
      pairingCode: code,
      expiresAt,
    };
    const signed = await deviceIdentity.signPayload(JSON.stringify(qrPayloadData));

    const qrPayload: PairingQRPayload = {
      ...qrPayloadData,
      signature: signed.signature,
    };

    this.onPairingCodeGenerated?.call(this, pairingCode);

    return { code: pairingCode, qrPayload };
  }

  async getQRCodeString(qrPayload: PairingQRPayload): Promise<string> {
    return btoa(JSON.stringify(qrPayload));
  }

  adoptPairingCode(code: string): void {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (this.pendingPairings.has(trimmed) && !this.pendingPairings.get(trimmed)!.resolved) {
      return;
    }
    this.pendingPairings.set(trimmed, {
      code: trimmed,
      deviceId: deviceIdentity.getDeviceId(),
      expiresAt: Date.now() + this.config.tokenExpirationMinutes * 60 * 1000,
      resolved: false,
    });
  }

  async handlePairingResponse(response: {
    deviceId: string;
    pairingCode: string;
    sessionToken?: string;
    success: boolean;
    errorMessage?: string;
    signature?: string;
    signerPublicKey?: string;
  }): Promise<PairingResult> {
    const matchingCode = response.pairingCode;
    const activePairing = this.pendingPairings.get(matchingCode);
    if (!activePairing || activePairing.deviceId !== response.deviceId || activePairing.resolved) {
      return { success: false, errorMessage: 'No matching pending pairing' };
    }
    const pairing = activePairing;

    if (Date.now() > pairing.expiresAt) {
      pairing.resolved = true;
      this.pendingPairings.delete(matchingCode);
      return {
        success: false,
        errorMessage: 'Pairing code has expired',
      };
    }

    if (!response.success) {
      pairing.resolved = true;
      this.pendingPairings.delete(matchingCode);
      return {
        success: false,
        errorMessage: response.errorMessage || 'Pairing rejected by desktop',
      };
    }

    if (!response.sessionToken || !response.signature || !response.signerPublicKey) {
      pairing.resolved = true;
      this.pendingPairings.delete(matchingCode);
      return { success: false, errorMessage: 'Pairing response is missing its token or desktop signature' };
    }
    const payload = JSON.stringify({ deviceId: response.deviceId, pairingCode: response.pairingCode, sessionToken: response.sessionToken, success: true });
    const verified = await deviceIdentity.verifySignature(payload, response.signature, response.signerPublicKey);
    if (!verified) {
      pairing.resolved = true;
      this.pendingPairings.delete(matchingCode);
      return { success: false, errorMessage: 'Invalid desktop signature' };
    }

    pairing.resolved = true;
    pairing.sessionToken = response.sessionToken;
    this.pendingPairings.delete(matchingCode);

    defaultPairingRateLimiter.reset(deviceIdentity.getDeviceId());

    const result: PairingResult = {
      success: true,
      sessionToken: response.sessionToken,
    };

    this.onPairingCompleted?.call(this, result);
    return result;
  }

  isCodeValid(code: string): boolean {
    const pairing = this.pendingPairings.get(code);
    if (!pairing || pairing.resolved) {
      return false;
    }
    return Date.now() < pairing.expiresAt;
  }

  getCodeTTL(code: string): number {
    const pairing = this.pendingPairings.get(code);
    if (!pairing) {
      return 0;
    }
    return Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
  }

  cancelPairing(code: string): void {
    const pairing = this.pendingPairings.get(code);
    if (pairing) {
      pairing.resolved = true;
      this.pendingPairings.delete(code);
    }
  }

  getSessionToken(deviceId: string): string | undefined {
    for (const pairing of this.pendingPairings.values()) {
      if (pairing.deviceId === deviceId && pairing.sessionToken) {
        return pairing.sessionToken;
      }
    }
    return undefined;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [code, pairing] of this.pendingPairings.entries()) {
      if (now > pairing.expiresAt) {
        pairing.resolved = true;
        this.pendingPairings.delete(code);
      }
    }
  }

  getPendingPairings(): PendingPairing[] {
    return Array.from(this.pendingPairings.values()).filter((p) => !p.resolved);
  }
}

export const pairingService = new PairingService();


function generatePairingCode(length: number): string {
  const digits = '0123456789';
  let code = '';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  for (let i = 0; i < length; i++) {
    code += digits[bytes[i] % digits.length];
  }
  return code;
}

function generateSessionToken(): string {
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
