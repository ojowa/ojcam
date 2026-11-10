/**
 * StreamingService.ts
 * Orchestrates camera, audio, encoder, WebRTC, signaling, and security.
 */

import {
  CameraService,
  AudioService,
  EncoderService,
  WebRTCService,
  type CameraDevice,
  type StreamConfig,
} from './native/modules';
import { signalingService } from './signaling/SignalingService';
import { authService } from './security/AuthService';
import { pairingService } from './security/PairingService';
import { deviceIdentity } from './security/DeviceIdentity';
import { initializeSecureStorage } from './security/SecureStorageAdapter';
import { createStartSession, type VideoConfig, type AudioConfig } from './protocol/messageTypes';
import { encodeMessageBase64 } from './protocol/ProtobufCodec';

export interface StreamingConfig {
  signalingUrl: string;
  deviceName: string;
  autoPair: boolean;
}

export interface StreamingState {
  isStreaming: boolean;
  isConnected: boolean;
  isAuthenticated: boolean;
  isPaired: boolean;
  currentCameraId: string | null;
  sessionTTL: number;
  error: string | null;
}

export const defaultStreamingConfig: StreamingConfig = {
  signalingUrl: 'ws://localhost:8080',
  deviceName: 'Ojowacam Mobile',
  autoPair: true,
};

export class StreamingService {
  private config: StreamingConfig;
  private isStreaming = false;
  private streamResourcesStarted = false;
  private currentCameraId: string | null = null;
  private streamConfig: StreamConfig = {
    resolution: '1920x1080',
    fps: 30,
    bitrate: 8000000,
    codec: 'H264',
  };

  private iceServers: string[] = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
  ];

  private state: StreamingState = {
    isStreaming: false,
    isConnected: false,
    isAuthenticated: false,
    isPaired: false,
    currentCameraId: null,
    sessionTTL: 0,
    error: null,
  };

  private onStateChange?: (state: StreamingState) => void;

  constructor(config: StreamingConfig = defaultStreamingConfig) {
    this.config = config;
    signalingService.setHandlers({
      onConnected: () => {
        this.state.isConnected = true;
        this.state.error = null;
        this.notifyStateChange();
      },
      onDisconnected: () => {
        this.state.isConnected = false;
        this.state.isAuthenticated = false;
        this.state.isPaired = false;
        if (this.isStreaming) { void this.stopStreaming(); }
        this.notifyStateChange();
      },
      onReconnecting: (attempt) => {
        this.state.error = `Reconnecting (attempt ${attempt})...`;
        this.notifyStateChange();
      },
      onMessage: (message) => this.handleIncomingSignalingMessage(message),
      onPairingCodeGenerated: (code) => {
        this.state.error = `Pairing code: ${code.code}`;
        this.notifyStateChange();
      },
      onPairingCompleted: (success, sessionToken, error) => {
        if (success && sessionToken) {
          this.state.isAuthenticated = true;
          this.state.isPaired = true;
          this.state.error = null;
        } else {
          this.state.error = error || 'Pairing failed';
        }
        this.notifyStateChange();
      },
      onError: (err) => {
        this.state.error = err.message;
        this.notifyStateChange();
      },
    });
  }

  setOnStateChange(callback: (state: StreamingState) => void): void {
    this.onStateChange = callback;
  }

  getState(): StreamingState {
    return { ...this.state };
  }

  async initialize(): Promise<boolean> {
    try {
      this.state.error = null;
      initializeSecureStorage();
      await deviceIdentity.initialize();
      await signalingService.initialize();
      await WebRTCService.initWebRTC();
      WebRTCService.onLocalSdp((type, sdp) => { void signalingService.sendOffer(sdp, type); });
      WebRTCService.onIceCandidate((candidate) => { void signalingService.sendIceCandidate(candidate); });
      WebRTCService.onConnectionStateChange((state) => {
        if (state === 'DISCONNECTED' || state === 'FAILED') {
          this.isStreaming = false;
          this.state.isStreaming = false;
          this.notifyStateChange();
        }
      });
      this.state.isConnected = signalingService.isConnected();
      this.state.isAuthenticated = authService.isAuthenticated();
      this.state.isPaired = authService.isPaired();
      this.state.sessionTTL = authService.getSessionTTL();
      return true;
    } catch (error) {
      console.error('Failed to initialize streaming:', error);
      this.state.error = error instanceof Error ? error.message : 'Initialization failed';
      this.notifyStateChange();
      return false;
    }
  }

  get width(): number {
    const [w] = this.streamConfig.resolution.split('x').map(Number);
    return w || 1920;
  }

  get height(): number {
    const [, h] = this.streamConfig.resolution.split('x').map(Number);
    return h || 1080;
  }

  async startStreaming(cameraId: string, config: StreamConfig, signalingUrl?: string): Promise<boolean> {
    if (this.isStreaming) { console.warn('Already streaming'); return false; }
    try {
      this.state.error = null;
      if (signalingUrl) { this.config.signalingUrl = signalingUrl; signalingService.setServerUrl(signalingUrl); }
      if (!authService.isAuthenticated()) {
        if (this.config.autoPair) {
          await signalingService.requestPairing();
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!authService.isAuthenticated()) {
            throw new Error('Authentication required. Please complete pairing first.');
          }
        } else {
          throw new Error('Not authenticated. Pairing required before streaming.');
        }
      }
      this.streamConfig = config;
      this.currentCameraId = cameraId;
      this.streamResourcesStarted = true;
      await CameraService.startCapture(cameraId, this.width, this.height, config.fps);
      await AudioService.startRecording();
      await EncoderService.initEncoder(this.width, this.height, config.bitrate, config.fps);
      await WebRTCService.createPeerConnection(this.iceServers);
      await WebRTCService.addVideoTrack(null);
      await WebRTCService.addAudioTrack(null);
      await WebRTCService.createOffer();
      const videoConfig: VideoConfig = {
        resolution: config.resolution, fps: config.fps, codec: config.codec, bitrate: config.bitrate,
      };
      const audioConfig: AudioConfig = { codec: 'OPUS', sampleRate: 48000, channels: 2 };
      const sessionMsg = createStartSession(`${deviceIdentity.getDeviceId()}-${Date.now()}`, videoConfig, audioConfig);
      const sessionBase64 = encodeMessageBase64(sessionMsg as import('./protocol/messageTypes').StartSession);
      const sent = await signalingService.sendStartSession(sessionBase64);
      if (!sent) throw new Error('Unable to send session configuration');
      this.isStreaming = true;
      this.state.isStreaming = true;
      this.state.currentCameraId = cameraId;
      this.state.sessionTTL = authService.getSessionTTL();
      this.state.error = null;
      this.notifyStateChange();
      console.log('Streaming started');
      return true;
    } catch (error) {
      console.error('Failed to start streaming:', error);
      this.state.error = error instanceof Error ? error.message : 'Failed to start streaming';
      this.notifyStateChange();
      await this.stopStreaming();
      return false;
    }
  }

  async stopStreaming(): Promise<boolean> {
    if (!this.isStreaming && !this.streamResourcesStarted) return true;
    const results = await Promise.allSettled([
      WebRTCService.closeConnection(), EncoderService.releaseEncoder(),
      AudioService.stopRecording(), CameraService.stopCapture(),
    ]);
    this.streamResourcesStarted = false;
    this.isStreaming = false;
    this.state.isStreaming = false;
    this.state.currentCameraId = null;
    const failure = results.find(result => result.status === 'rejected');
    this.state.error = failure?.status === 'rejected'
      ? (failure.reason instanceof Error ? failure.reason.message : 'Failed to release streaming resources')
      : null;
    this.notifyStateChange();
    return failure === undefined;
  }

  async handleIncomingSignalingMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'ANSWER': await WebRTCService.setRemoteDescription('answer', message.sdp); break;
      case 'ICE_CANDIDATE': await WebRTCService.addIceCandidate(message.candidate); break;
      case 'PAIRING_RESPONSE':
        this.state.isAuthenticated = authService.isAuthenticated();
        this.state.isPaired = authService.isPaired();
        this.notifyStateChange();
        break;
      case 'START_SESSION': console.log('Desktop acknowledged session:', message.sessionId); break;
      default: console.log('Received signaling message:', message.type);
    }
  }

  async getAvailableCameras(): Promise<CameraDevice[]> {
    return CameraService.getAvailableCameras();
  }

  getIsStreaming(): boolean { return this.isStreaming; }
  getCurrentCameraId(): string | null { return this.currentCameraId; }
  getConfig(): StreamConfig { return { ...this.streamConfig }; }
  getSignalingState(): any { return signalingService.getState(); }
  isAuthenticated(): boolean { return authService.isAuthenticated(); }
  isPaired(): boolean { return authService.isPaired(); }

  private notifyStateChange(): void {
    this.state.isConnected = signalingService.isConnected();
    this.state.isAuthenticated = authService.isAuthenticated();
    this.state.isPaired = authService.isPaired();
    this.state.sessionTTL = authService.getSessionTTL();
    this.onStateChange?.(this.getState());
  }
}

export const streamingService = new StreamingService();
