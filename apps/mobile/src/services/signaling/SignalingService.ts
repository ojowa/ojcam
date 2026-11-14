import { SignalingServer, defaultTransportConfig, type TransportState } from './SignalingServer';
import { authService } from '../security/AuthService';
import { deviceIdentity } from '../security/DeviceIdentity';
import { encodeMessage, decodeMessageBase64 } from '../protocol/ProtobufCodec';
import type { ProtocolMessage } from '../protocol/messageTypes';
import { connectionConfig } from '../config/ConnectionConfig';

export interface SignalingConfig { serverUrl: string; deviceName: string; autoConnect: boolean }
export interface SignalingMessage {
  type: string; sessionId?: string; sdp?: string; sdpType?: string; candidate?: string;
  deviceId?: string; pairingCode?: string; errorMessage?: string; authenticated?: boolean;
  signature?: string; signatureAlgorithm?: string; signerPublicKey?: string; timestamp?: number;
  sessionToken?: string; success?: boolean; payload?: string;
}
export interface SignalingEventHandlers {
  onConnected?: () => void; onDisconnected?: () => void; onReconnecting?: (attempt: number) => void;
  onMessage?: (message: SignalingMessage) => void;
  onPairingCompleted?: (success: boolean, sessionToken?: string, error?: string) => void;
  onError?: (error: Error) => void;
}
export const defaultSignalingConfig: SignalingConfig = {
  serverUrl: connectionConfig.getSignalingUrl(),
  deviceName: 'Ojowacam Mobile',
  autoConnect: true,
};

export class SignalingService {
  private config: SignalingConfig;
  private transport: SignalingServer;
  private handlers: SignalingEventHandlers = {};
  private isInitializing = false;
  private pairingRetryTimer: ReturnType<typeof setInterval> | null = null;
  private lastPairingRequest: Record<string, unknown> | null = null;

  constructor(config: SignalingConfig = defaultSignalingConfig) {
    this.config = { ...config };
    this.transport = new SignalingServer({ ...defaultTransportConfig, url: config.serverUrl });
    this.transport.setOnMessage(data => { void this.handleIncomingMessage(data); });
    this.transport.setOnStateChange(state => this.handleStateChange(state));
    this.transport.setOnError(err => this.handlers.onError?.(err));
    // Sessions are short-lived; re-handshake automatically whenever one expires.
    authService.setOnSessionExpired(() => { void this.requestPairing(); });
  }
  setHandlers(handlers: SignalingEventHandlers): void {
    this.handlers = handlers;
  }
  async initialize(): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;
    try {
      await connectionConfig.load();
      this.config.serverUrl = connectionConfig.getSignalingUrl();
      this.transport.setUrl(this.config.serverUrl);
      await deviceIdentity.initialize();
      if (this.config.autoConnect) await this.connect();
    } finally { this.isInitializing = false; }
  }
  async connect(): Promise<void> {
    await connectionConfig.load();
    this.config.serverUrl = connectionConfig.getSignalingUrl();
    this.transport.setUrl(this.config.serverUrl);
    await this.transport.connect();
  }
  setServerUrl(url: string): void { this.config.serverUrl = url; this.transport.setUrl(url); }
  getServerUrl(): string { return this.config.serverUrl; }
  async sendReliable(data: string): Promise<boolean> { return this.transport.sendReliable(data); }
  /**
   * Stream one raw PCM chunk to OBS (WebSocket binary frame, opcode 0x2).
   * Returns false when no peer is ready — the caller drops the chunk.
   */
  sendAudioFrame(pcm: Uint8Array): boolean { return this.transport.sendBinary(pcm); }
  async sendStartSession(payload: string, sessionId?: string): Promise<boolean> {
    const message = await authService.authenticateMessage({ type: 'START_SESSION', sessionId, payload, deviceId: deviceIdentity.getDeviceId() });
    return this.transport.sendReliable(JSON.stringify(message));
  }
  async sendOffer(sdp: string, sdpType: string, sessionId?: string): Promise<void> { await this.sendAuthenticated({ type: 'OFFER', sdp, sdpType, sessionId, deviceId: deviceIdentity.getDeviceId() }); }
  async sendIceCandidate(candidate: string, sessionId?: string): Promise<void> { await this.sendAuthenticated({ type: 'ICE_CANDIDATE', candidate, sessionId, deviceId: deviceIdentity.getDeviceId() }); }
  async sendAnswer(sdp: string, sdpType: string, sessionId?: string): Promise<void> { await this.sendAuthenticated({ type: 'ANSWER', sdp, sdpType, sessionId, deviceId: deviceIdentity.getDeviceId() }); }
  private async sendAuthenticated(message: SignalingMessage): Promise<void> { this.transport.send(JSON.stringify(await authService.authenticateMessage(message as unknown as Record<string, unknown>))); }
  async sendDeviceAnnouncement(): Promise<void> {
    const announcement = { type: 'DEVICE_ANNOUNCEMENT' as const, deviceId: deviceIdentity.getDeviceId(), deviceName: this.config.deviceName,
      capabilities: { video: true, audio: true, resolutions: ['1280x720', '1920x1080', '3840x2160'], frameRates: [30, 60] } };
    const data = encodeMessage(announcement);
    let binary = ''; for (const byte of data) binary += String.fromCharCode(byte);
    await this.sendAuthenticated({ type: 'DEVICE_ANNOUNCEMENT', deviceId: announcement.deviceId, payload: btoa(binary) });
  }
  /**
   * Ask the connected peer for a session. The OBS plugin auto-accepts and
   * replies with a sessionToken — no pairing code involved.
   */
  async requestPairing(): Promise<void> {
    this.sendPairingRequest({ type: 'PAIRING_REQUEST', deviceId: deviceIdentity.getDeviceId() });
  }
  disconnect(): void {
    this.stopPairingRetry();
    this.lastPairingRequest = null;
    this.transport.disconnect();
    authService.expireSession();
  }

  private sendPairingRequest(payload: Record<string, unknown>): void {
    this.lastPairingRequest = payload;
    this.transport.send(JSON.stringify(payload));
    this.stopPairingRetry();
    this.pairingRetryTimer = setInterval(() => {
      if (this.transport.isConnected() && this.transport.hasPeer() && this.lastPairingRequest) {
        this.transport.send(JSON.stringify(this.lastPairingRequest));
      }
    }, 5000);
  }
  private stopPairingRetry(): void {
    if (this.pairingRetryTimer) clearInterval(this.pairingRetryTimer);
    this.pairingRetryTimer = null;
  }

  private async handleIncomingMessage(data: string): Promise<void> {
    let message: SignalingMessage;
    try { message = JSON.parse(data) as SignalingMessage; }
    catch {
      try { this.handleProtobufMessage(decodeMessageBase64(data)); }
      catch { console.warn('Received unparseable signaling message'); }
      return;
    }
    if (message.type === 'PING') { this.transport.send(JSON.stringify({ type: 'PONG' })); return; }
    if (message.type === 'PONG') return;
    if (message.type === 'PAIRING_RESPONSE') {
      if (message.success && message.sessionToken) {
        await authService.establishSession(message.sessionToken);
        this.stopPairingRetry();
        this.lastPairingRequest = null;
        this.handlers.onPairingCompleted?.(true, message.sessionToken);
      } else {
        this.handlers.onPairingCompleted?.(false, undefined, message.errorMessage);
      }
      return;
    }
    if (message.type === 'PAIRING_ERROR') {
      this.handlers.onPairingCompleted?.(false, undefined, message.errorMessage);
      return;
    }
    if (message.type === 'ERROR') {
      // The peer lost our session (e.g. OBS restarted) — re-handshake.
      void this.requestPairing();
      this.handlers.onError?.(new Error(message.errorMessage || 'Signaling error'));
      return;
    }
    const validation = await authService.validateIncomingMessage(message as unknown as Record<string, unknown>);
    if (!validation.valid) { console.warn('Rejected signaling message:', validation.reason); return; }
    this.handlers.onMessage?.(message);
  }
  private handleProtobufMessage(message: ProtocolMessage): void {
    if (message.type === 'DEVICE_ANNOUNCEMENT') this.handlers.onMessage?.({ type: message.type, deviceId: message.deviceId });
  }
  private handleStateChange(state: TransportState): void {
    if (state.connected) {
      if (state.attemptCount === 0) {
        this.handlers.onConnected?.();
        void this.sendDeviceAnnouncement().catch(() => undefined);
        // Seamless: establish a session with every peer that connects.
        void this.requestPairing();
      }
    } else if (state.reconnecting) this.handlers.onReconnecting?.(state.attemptCount);
    else this.handlers.onDisconnected?.();
  }
  getState(): TransportState { return this.transport.getState(); }
  isConnected(): boolean { return this.transport.isConnected(); }
  /** True once the phone-hosted server bound its port (peer may join later). */
  isListening(): boolean { return this.transport.isListening(); }
  isAuthenticated(): boolean { return authService.isAuthenticated(); }
  getSessionTTL(): number { return authService.getSessionTTL(); }
}
export const signalingService = new SignalingService();
