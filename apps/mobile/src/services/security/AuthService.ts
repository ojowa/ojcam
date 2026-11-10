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
export interface AuthConfig { sessionExpirationMinutes: number }
export const defaultAuthConfig: AuthConfig = { sessionExpirationMinutes: 10 };

export class AuthService {
  private config: AuthConfig;
  private session: SessionInfo | null = null;
  private onSessionEstablished?: (session: SessionInfo) => void;
  private onSessionExpired?: () => void;
  private onAuthenticationRequired?: () => void;

  constructor(config: AuthConfig = defaultAuthConfig) {
    this.config = config;
    const timer = setInterval(() => this.checkSessionExpiry(), 30_000);
    (timer as unknown as { unref?: () => void }).unref?.();
  }
  setOnSessionEstablished(callback: (session: SessionInfo) => void): void { this.onSessionEstablished = callback; }
  setOnSessionExpired(callback: () => void): void { this.onSessionExpired = callback; }
  setOnAuthenticationRequired(callback: () => void): void { this.onAuthenticationRequired = callback; }

  async establishSession(sessionToken: string, desktopPublicKey?: string): Promise<SessionInfo> {
    if (!sessionToken) throw new Error('A session token is required');
    const now = Date.now();
    const session: SessionInfo = {
      token: sessionToken,
      deviceId: deviceIdentity.getDeviceId(),
      desktopPublicKey,
      issuedAt: now,
      expiresAt: now + this.config.sessionExpirationMinutes * 60_000,
      authenticated: true,
    };
    this.session = session;
    this.onSessionEstablished?.(session);
    return session;
  }

  async signMessage(message: Record<string, unknown>): Promise<SignedPayload> {
    const session = this.getSession();
    if (!session) {
      this.onAuthenticationRequired?.();
      throw new Error('No active session. Pairing required.');
    }
    const payload = JSON.stringify({ ...message, deviceId: session.deviceId, sessionToken: session.token, timestamp: Date.now() });
    return deviceIdentity.signPayload(payload);
  }

  async authenticateMessage(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    const session = this.getSession();
    if (!session) return { ...message, authenticated: false };
    const signed = await this.signMessage(message);
    return { ...message, deviceId: session.deviceId, sessionToken: session.token, signature: signed.signature, signatureAlgorithm: signed.algorithm, timestamp: Date.now(), authenticated: true };
  }

  async validateIncomingMessage(message: Record<string, unknown>, desktopPublicKey?: string): Promise<{ valid: boolean; reason?: string }> {
    const session = this.getSession();
    if (!session) return { valid: false, reason: 'No active session' };
    if (message.sessionToken !== session.token) return { valid: false, reason: 'Session token missing or mismatched' };
    const key = desktopPublicKey || session.desktopPublicKey;
    if (typeof message.timestamp !== 'number' || Math.abs(Date.now() - message.timestamp) > 5 * 60_000) {
      return { valid: false, reason: 'Message timestamp is missing or expired' };
    }
    if (!key || typeof message.signature !== 'string') {
      return { valid: false, reason: 'Missing desktop signature, key, or timestamp' };
    }
    const payload = JSON.stringify({ type: message.type, sessionId: message.sessionId, timestamp: message.timestamp });
    const verified = await deviceIdentity.verifySignature(payload, message.signature, key);
    return verified ? { valid: true } : { valid: false, reason: 'Invalid desktop signature' };
  }

  expireSession(): void {
    if (this.session) { this.session = null; this.onSessionExpired?.(); }
  }
  private checkSessionExpiry(): void {
    if (this.session && Date.now() >= this.session.expiresAt) this.expireSession();
  }
  getSession(): SessionInfo | null {
    if (this.session && Date.now() >= this.session.expiresAt) this.expireSession();
    return this.session;
  }
  isAuthenticated(): boolean { return this.getSession()?.authenticated === true; }
  getAuthToken(): string | null { return this.getSession()?.token ?? null; }
  getSessionTTL(): number { const session = this.getSession(); return session ? Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000)) : 0; }
  isPaired(): boolean { return pairingService.getPendingPairings().length === 0 && this.isAuthenticated(); }
}
export const authService = new AuthService();
