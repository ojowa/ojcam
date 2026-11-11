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
} from '../native/modules';
import { PermissionsAndroid, Platform } from 'react-native';
import { signalingService } from './signaling/SignalingService';
import { authService } from './security/AuthService';
import { pairingService } from './security/PairingService';
import { deviceIdentity } from './security/DeviceIdentity';
import { initializeSecureStorage } from './security/SecureStorageAdapter';
import { connectionConfig } from './config/ConnectionConfig';
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
  pairingCode: string | null;
}

export const defaultStreamingConfig: StreamingConfig = {
  signalingUrl: connectionConfig.getSignalingUrl(),
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
    pairingCode: null,
  };

  private onStateChange?: (state: StreamingState) => void;
  private pairingWaiter: { resolve: (success: boolean) => void } | null = null;

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
        this.state.pairingCode = code.code;
        this.state.error = `Pairing code: ${code.code}`;
        this.notifyStateChange();
      },
      onPairingCompleted: (success, sessionToken, error) => {
        this.state.pairingCode = null;
        if (success && sessionToken) {
          this.state.isAuthenticated = true;
          this.state.isPaired = true;
          this.state.error = null;
        } else {
          this.state.error = error || 'Pairing failed';
        }
        this.notifyStateChange();
        const waiter = this.pairingWaiter;
        this.pairingWaiter = null;
        waiter?.resolve(success);
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
      await connectionConfig.load();
      this.config.signalingUrl = connectionConfig.getSignalingUrl();
      signalingService.setServerUrl(this.config.signalingUrl);
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

  /**
   * Start the phone-hosted signaling server (or reuse it).
   * Returns the local signaling URL on success.
   */
  async connectSignaling(): Promise<string> {
    await connectionConfig.load();
    const url = connectionConfig.getSignalingUrl();
    this.config.signalingUrl = url;
    signalingService.setServerUrl(url);
    this.state.error = null;
    this.notifyStateChange();
    try {
      await signalingService.initialize();
      if (!signalingService.isConnected()) {
        await signalingService.connect();
      }
      this.state.isConnected = signalingService.isConnected();
      if (!this.state.isConnected) {
        throw new Error(`Unable to connect to ${url}`);
      }
      this.notifyStateChange();
      return url;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to connect to ${url}`;
      this.state.isConnected = false;
      this.state.error = message;
      this.notifyStateChange();
      throw new Error(message);
    }
  }

  async disconnectSignaling(): Promise<void> {
    signalingService.disconnect();
    this.state.isConnected = false;
    this.state.isAuthenticated = false;
    this.state.isPaired = false;
    this.state.pairingCode = null;
    this.notifyStateChange();
  }

  getSignalingUrl(): string {
    return connectionConfig.getSignalingUrl();
  }

  get width(): number {
    const [w] = this.streamConfig.resolution.split('x').map(Number);
    return w || 1920;
  }

  get height(): number {
    const [, h] = this.streamConfig.resolution.split('x').map(Number);
    return h || 1080;
  }

  async requestPairing(): Promise<string> {
    const { code } = await signalingService.requestPairing();
    this.state.pairingCode = code;
    this.state.error = `Pairing code: ${code}`;
    this.notifyStateChange();
    return code;
  }

  async submitPairingCode(code: string): Promise<void> {
    const trimmed = code.trim();
    if (!trimmed) throw new Error('Pairing code is required');
    await signalingService.submitPairingCode(trimmed);
    this.state.pairingCode = trimmed;
    this.state.error = `Waiting for desktop to confirm code ${trimmed}...`;
    this.notifyStateChange();
  }

  private waitForPairing(timeoutMs: number): Promise<boolean> {
    if (authService.isAuthenticated()) return Promise.resolve(true);
    if (this.pairingWaiter) {
      // A wait is already in progress; piggy-back on it via a short poll fallback.
      return new Promise((resolve) => {
        const start = Date.now();
        const poll = setInterval(() => {
          if (authService.isAuthenticated()) {
            clearInterval(poll);
            resolve(true);
          } else if (Date.now() - start >= timeoutMs) {
            clearInterval(poll);
            resolve(false);
          }
        }, 250);
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pairingWaiter) {
          this.pairingWaiter = null;
          resolve(false);
        }
      }, timeoutMs);
      this.pairingWaiter = {
        resolve: (success) => {
          clearTimeout(timer);
          resolve(success || authService.isAuthenticated());
        },
      };
    });
  }

  async startStreaming(cameraId: string, config: StreamConfig): Promise<boolean> {
    if (this.isStreaming) { console.warn('Already streaming'); return false; }
    try {
      this.state.error = null;
      await connectionConfig.load();
      this.config.signalingUrl = connectionConfig.getSignalingUrl();
      signalingService.setServerUrl(this.config.signalingUrl);
      if (!signalingService.isConnected()) {
        await signalingService.connect();
      }
      if (!authService.isAuthenticated()) {
        if (this.config.autoPair) {
          await this.requestPairing();
          const paired = await this.waitForPairing(10 * 60 * 1000);
          this.state.pairingCode = null;
          if (!paired || !authService.isAuthenticated()) {
            throw new Error('Authentication required. Please complete pairing first.');
          }
        } else {
          throw new Error('Not authenticated. Pairing required before streaming.');
        }
      }
      // Android runtime permissions must be granted before native capture.
      if (Platform.OS === 'android') {
        const perms = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        const cameraOk = perms[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
        const micOk = perms[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
        if (!cameraOk || !micOk) {
          throw new Error('Camera and microphone permissions are required to stream.');
        }
      }
      this.streamConfig = config;
      this.currentCameraId = cameraId;
      this.streamResourcesStarted = true;
      await CameraService.startCapture(cameraId, this.width, this.height, config.fps);
      await AudioService.startRecording();
      await EncoderService.initEncoder(this.width, this.height, config.bitrate, config.fps);
      await WebRTCService.createPeerConnection(this.iceServers);
      await WebRTCService.addVideoTrack('ojowacam-video');
      await WebRTCService.addAudioTrack('ojowacam-audio');
      await WebRTCService.createOffer();
      const videoConfig: VideoConfig = {
        resolution: config.resolution, fps: config.fps, codec: config.codec, bitrate: config.bitrate,
      };
      const audioConfig: AudioConfig = { codec: 'OPUS', sampleRate: 48000, channels: 2 };
      const sessionId = `${deviceIdentity.getDeviceId()}-${Date.now()}`;
      const sessionMsg = createStartSession(sessionId, videoConfig, audioConfig);
      const sessionBase64 = encodeMessageBase64(sessionMsg as import('./protocol/messageTypes').StartSession);
      const sent = await signalingService.sendStartSession(sessionBase64, sessionId);
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
