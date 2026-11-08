/**
 * AuthService.ts
 * 
 * Session token management and authentication for the mobile app.
 * 
 * Security requirement: "Authentication: The desktop application only accepts
 * connections from paired devices" (SECURITY.md)
 */

import { deviceIdentity, type SignedPayload } from './DeviceIdentity';
import { pairingService } from './PairingService';

export interface SessionInfo {
  token: string;
  deviceId: string;
  desktopPublicKey?: string;
  issuedAt: number;
  expiresAt: number;
  authenticated: boolean;
}

export interface AuthConfig {
  sessionExpirationMinutes: number;
}

export const defaultAuthConfig: AuthConfig = {
  sessionExpirationMinutes: 10,
};

export class AuthService {
  private config: AuthConfig;
  private session: SessionInfo | null = null;
  private onSessionEstablished?: (session: SessionInfo) => void;
  private onSessionExpired?: () => void;
  private onAuthenticationRequired?: () => void;

  constructor(config: AuthConfig = defaultAuthConfig) {
    this.config = config;
    setInterval(() => this.checkSessionExpiry(), 30 * 1000).unref?.();
  }

  setOnSessionEstablished(callback: (session: SessionInfo) => void): void {
    this.onSessionEstablished = callback;
  }

  setOnSessionExpired(callback: () => void): void {
    this.onSessionExpired = callback;
  }

  setOnAuthenticationRequired(callback: () => void): void {
    this.onAuthenticationRequired = callback;
  }

  async establishSession(
    sessionToken: string,
    desktopPublicKey?: string
  ): Promise<SessionInfo> {
    const deviceId = deviceIdentity.getDeviceId();
    const now = Date.now();
    const expiresAt = now + this.config.sessionExpirationMinutes * 60 * 1000;

    this.session = {
      token: sessionToken,
      deviceId,
      desktopPublicKey,
      issuedAt: now,
      expiresAt,
      authenticated: true,
    };


  async signMessage(message: Record<string, unknown>): Promise<SignedPayload> {
    const session = this.getSession();
    if (!session) {
      throw new Error('No active session. Pairing required.');
    }

    const payload = JSON.stringify({
      ...message,
      deviceId: session.deviceId,
      sessionToken: session.token,
      timestamp: Date.now(),
    });

    return deviceIdentity.signPayload(payload);
  }

  async authenticateMessage(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    const session = this.getSession();
    if (!session) {
      return { ...message, authenticated: false };
    }

    const signed = await this.signMessage(message);

    return {
      ...message,
      deviceId: session.deviceId,
      sessionToken: session.token,
      signature: signed.signature,
      signatureAlgorithm: signed.algorithm,
      timestamp: Date.now(),
      authenticated: true,
    };
  }

  async validateIncomingMessage(
    message: Record<string, unknown>,
    desktopPublicKey?: string
  ): Promise<{ valid: boolean; reason?: string }> {
    const session = this.getSession();
    if (!session) {
      return { valid: false, reason: 'No active session' };
    }

    if (message.signature && (desktopPublicKey || session.desktopPublicKey)) {
      const key = desktopPublicKey || session.desktopPublicKey!;
      const payload = JSON.stringify({
        type: message.type,
        sessionId: message.sessionId,
        timestamp: message.timestamp,
      });

      const verified = await deviceIdentity.verifySignature(
        payload,
        message.signature as string,
        key
      );
      if (!verified) {
        return { valid: false, reason: 'Invalid desktop signature' };
      }
    }

    if (message.sessionToken && message.sessionToken !== session.token) {
      return { valid: false, reason: 'Session token mismatch' };
    }

    return { valid: true };
  }

  expireSession(): void {
    if (this.session) {
      this.session = null;
      this.onSessionExpired?.call(this);
    }
  }

  private checkSessionExpiry(): void {
    if (this.session && Date.now() > this.session.expiresAt) {
      this.session = null;
      this.onSessionExpired?.call(this);
    }
  }

  getSessionTTL(): number {
    if (!this.session) {
      return 0;
    }
    return Math.max(0, Math.ceil((this.session.expiresAt - Date.now()) / 1000));
  }

  isPaired(): boolean {
    return pairingService.getPendingPairings().length === 0 && this.isAuthenticated();
  }
}

export const authService = new AuthService();

    this.onSessionEstablished?.call(this, this.session);
    return this.session;
  }

  getSession(): SessionInfo | null {
    if (!this.session) {
      return null;
    }
    if (Date.now() > this.session.expiresAt) {
      this.session = null;
      this.onSessionExpired?.call(this);
      return null;
    }
    return this.session;
  }

  isAuthenticated(): boolean {
    const session = this.getSession();
    return session !== null && session.authenticated;
  }

  getAuthToken(): string | null {
    const session = this.getSession();
    return session?.token ?? null;
  }