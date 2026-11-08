/**
 * SignalingService.ts
 * 
 * High-level WebSocket signaling client for the Ojowacam mobile app.
 * 
 * Integrates WebSocketTransport, AuthService, PairingService, and ProtobufCodec.
 */

import { WebSocketTransport, defaultTransportConfig, type TransportState } from './WebSocketTransport';
import { authService } from '../security/AuthService';
import { pairingService, type PairingQRPayload } from '../security/PairingService';
import { deviceIdentity } from '../security/DeviceIdentity';
import { encodeMessage, decodeMessageBase64, type ProtocolMessage } from '../protocol/ProtobufCodec';

export interface SignalingConfig {
  serverUrl: string;
  deviceName: string;
  autoConnect: boolean;
}

export interface SignalingMessage {
  type: string;
  sessionId?: string;
  sdp?: string;
  sdpType?: string;
  candidate?: string;
  deviceId?: string;
  pairingCode?: string;
  errorMessage?: string;
  authenticated?: boolean;
  signature?: string;
  signatureAlgorithm?: string;
  timestamp?: number;
}

export interface SignalingEventHandlers {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: (attempt: number) => void;
  onMessage?: (message: SignalingMessage) => void;
  onPairingCodeGenerated?: (code: string, qrPayload: PairingQRPayload) => void;
  onPairingCompleted?: (success: boolean, sessionToken?: string, error?: string) => void;
  onError?: (error: Error) => void;
}

export const defaultSignalingConfig: SignalingConfig = {
  serverUrl: 'ws://localhost:8080',
  deviceName: 'Ojowacam Mobile',
  autoConnect: true,
};

export class SignalingService {
  private config: SignalingConfig;
  private transport: WebSocketTransport;
  private handlers: SignalingEventHandlers = {};
  private pendingOffers: Map<string, { resolve: (sdp: string) => void; reject: (err: Error) => void }> = new Map();
  private isInitializing = false;

  constructor(config: SignalingConfig = defaultSignalingConfig) {
    this.config = config;
    this.transport = new WebSocketTransport(defaultTransportConfig);

    this.transport.setOnMessage((data) => this.handleIncomingMessage(data));
    this.transport.setOnStateChange((state) => this.handleStateChange(state));

  async initialize(): Promise<void> {
    if (this.isInitializing) {
      return;
    }
    this.isInitializing = true;

    try {
      await deviceIdentity.initialize();

      if (this.config.autoConnect) {
        await this.connect();
      }
    } finally {
      this.isInitializing = false;
    }
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async sendOffer(sdp: string, sdpType: string, sessionId?: string): Promise<void> {
    const message: SignalingMessage = {
      type: 'OFFER',
      sdp,
      sdpType,
      sessionId,
      deviceId: deviceIdentity.getDeviceId(),
    };
    const authenticated = await authService.authenticateMessage(message);
    this.transport.send(JSON.stringify(authenticated));
  }

  async sendIceCandidate(candidate: string, sessionId?: string): Promise<void> {
    const message: SignalingMessage = {
      type: 'ICE_CANDIDATE',
      candidate,
      sessionId,
      deviceId: deviceIdentity.getDeviceId(),
    };
    const authenticated = await authService.authenticateMessage(message);
    this.transport.send(JSON.stringify(authenticated));
  }

  async sendAnswer(sdp: string, sdpType: string, sessionId?: string): Promise<void> {
    const message: SignalingMessage = {
      type: 'ANSWER',
      sdp,
      sdpType,
      sessionId,
      deviceId: deviceIdentity.getDeviceId(),
    };
    const authenticated = await authService.authenticateMessage(message);
    this.transport.send(JSON.stringify(authenticated));
  }

  async sendDeviceAnnouncement(): Promise<void> {
    const announcement = {
      type: 'DEVICE_ANNOUNCEMENT' as const,
      deviceId: deviceIdentity.getDeviceId(),
      deviceName: this.config.deviceName,

  private async handleIncomingMessage(data: string): Promise<void> {
    let message: SignalingMessage;

    try {
      message = JSON.parse(data);
    } catch {
      try {
        const protoMsg = decodeMessageBase64(data);
        this.handleProtobufMessage(protoMsg);
        return;
      } catch {
        console.warn('Received unparseable signaling message');
        return;
      }
    }

    if (message.type === 'PING') {
      this.transport.send(JSON.stringify({ type: 'PONG' }));
      return;
    }
    if (message.type === 'PONG') {
      return;
    }

    const validation = await authService.validateIncomingMessage(message);
    if (!validation.valid) {
      console.warn('Incoming message validation failed:', validation.reason);
    }

    if (message.type === 'PAIRING_RESPONSE') {
      const result = await pairingService.handlePairingResponse({
        deviceId: message.deviceId || '',
        sessionToken: message.sessionToken || undefined,
        success: message.success !== undefined ? message.success : true,
        errorMessage: message.errorMessage,
        signature: message.signature,
        signerPublicKey: message.signatureAlgorithm,
      });

      if (result.sessionToken) {
        await authService.establishSession(result.sessionToken, message.signatureAlgorithm);
      }

      this.handlers.onPairingCompleted?.call(
        result.success,
        result.sessionToken,
        result.errorMessage
      );
      return;
    }

    if (message.type === 'PAIRING_ERROR' || message.type === 'ERROR') {
      this.handlers.onPairingCompleted?.call(false, undefined, message.errorMessage);
      return;
    }

    this.handlers.onMessage?.call(this, message);
  }

  private handleProtobufMessage(msg: ProtocolMessage): void {
    if (msg.type === 'DEVICE_ANNOUNCEMENT') {
      this.handlers.onMessage?.call(this, {
        type: 'DEVICE_ANNOUNCEMENT',
        deviceId: msg.deviceId,
      } as SignalingMessage);
    }
  }

  private handleStateChange(state: TransportState): void {
    if (state.connected && state.attemptCount === 0) {
      this.handlers.onConnected?.call(this);
      this.sendDeviceAnnouncement().catch(() => {
        // ignore announcement failures
      });
    } else if (!state.connected && state.reconnecting) {
      this.handlers.onReconnecting?.call(this, state.attemptCount);
    } else if (!state.connected && state.attemptCount === 0) {
      this.handlers.onDisconnected?.call(this);
    }
  }

  getState(): TransportState {
    return this.transport.getState();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  isAuthenticated(): boolean {
    return authService.isAuthenticated();
  }

  getSessionTTL(): number {
    return authService.getSessionTTL();
  }
}

export const signalingService = new SignalingService();

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

      capabilities: {
        video: true,
        audio: true,
        resolutions: ['1280x720', '1920x1080', '3840x2160'],
        frameRates: [30, 60],
      },
    };
    const encoded = encodeMessage(announcement as import('../protocol/messageTypes').DeviceAnnouncement);
    const message: SignalingMessage = {
      type: 'DEVICE_ANNOUNCEMENT',
      deviceId: deviceIdentity.getDeviceId(),
    };
    const binaryBase64 = arrayBufferToBase64(encoded);
    const authenticated = await authService.authenticateMessage({
      ...message,
      _binaryPayload: binaryBase64,
    });
    this.transport.send(JSON.stringify(authenticated));
  }

  disconnect(): void {
    this.transport.disconnect();
    authService.expireSession();
  }

  async requestPairing(): Promise<{ code: string; qrPayload: PairingQRPayload }> {
    const deviceId = deviceIdentity.getDeviceId();

    if (this.transport.isConnected()) {
      const request: SignalingMessage = {
        type: 'PAIRING_REQUEST',
        deviceId,
      };
      const authenticated = await authService.authenticateMessage(request);
      this.transport.send(JSON.stringify(authenticated));
    }

    const result = await pairingService.generatePairingCode(this.config.deviceName);
    return result;
  }
    this.transport.setOnError((err) => this.handlers.onError?.call(this, err));
  }

  setHandlers(handlers: SignalingEventHandlers): void {
    this.handlers = handlers;
    pairingService.setOnPairingCodeGenerated((code) => {
      this.handlers.onPairingCodeGenerated?.call(this, code.code, { code: code.code, deviceId: '', deviceName: '', publicKey: '', pairingCode: code.code, expiresAt: code.expiresAt, signature: '' } as PairingQRPayload);
    });
    pairingService.setOnPairingCompleted((result) => {
      this.handlers.onPairingCompleted?.call(this, result.success, result.sessionToken, result.errorMessage);
    });
  }