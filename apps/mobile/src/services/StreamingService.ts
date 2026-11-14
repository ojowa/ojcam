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
import { deviceIdentity } from './security/DeviceIdentity';
import { initializeSecureStorage } from './security/SecureStorageAdapter';
import { connectionConfig } from './config/ConnectionConfig';
import { streamSettings } from './config/StreamSettings';
import { createStartSession, type VideoConfig, type AudioConfig } from './protocol/messageTypes';
import { encodeMessageBase64 } from './protocol/ProtobufCodec';

export interface StreamingConfig {
  signalingUrl: string;
  deviceName: string;
  autoPair: boolean;
}

export interface StreamingState {
  isStreaming: boolean;
  isAudioBroadcasting: boolean;
  isConnected: boolean;
  isAuthenticated: boolean;
  currentCameraId: string | null;
  sessionTTL: number;
  error: string | null;
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
    resolution: '3840x2160',
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
    isAudioBroadcasting: false,
    isConnected: false,
    isAuthenticated: false,
    currentCameraId: null,
    sessionTTL: 0,
    error: null,
  };

  private onStateChange?: (state: StreamingState) => void;
  private pairingWaiter: { resolve: (success: boolean) => void } | null = null;
  /** Wireless Mic state: capture running + mute flag (mute sends nothing). */
  private audioBroadcasting = false;
  private audioMuted = false;

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
        if (this.isStreaming) { void this.stopStreaming(); }
        if (this.audioBroadcasting) { void this.stopAudioBroadcast(); }
        this.notifyStateChange();
      },
      onReconnecting: (attempt) => {
        this.state.error = `Reconnecting (attempt ${attempt})...`;
        this.notifyStateChange();
      },
      onMessage: (message) => this.handleIncomingSignalingMessage(message),
      onPairingCompleted: (success, sessionToken, error) => {
        if (success && sessionToken) {
          this.state.error = null;
        } else {
          this.state.error = error || 'Session handshake failed';
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
      if (!signalingService.isListening()) {
        await signalingService.connect();
      }
      // Success means the phone's WebSocket server bound its port. A peer
      // (the OBS plugin) may attach later — discovery and the phone's dial
      // out handle that, so "no peer yet" is NOT an error here.
      if (!signalingService.isListening()) {
        throw new Error(`Unable to start the signaling server on ${url}`);
      }
      this.state.isConnected = signalingService.isConnected();
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

  /** Request a session from the connected peer (auto-accepted by OBS). */
  async requestPairing(): Promise<void> {
    await signalingService.requestPairing();
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
    if (this.audioBroadcasting) {
      this.state.error = 'Stop the Wireless Mic broadcast before starting the camera stream.';
      this.notifyStateChange();
      return false;
    }
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
          const paired = await this.waitForPairing(30 * 1000);
          if (!paired || !authService.isAuthenticated()) {
            throw new Error('Unable to establish a session with OBS.');
          }
        } else {
          throw new Error('Not authenticated. Session required before streaming.');
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
      console.log('[stream] step: permissions');
      // The camera may negotiate a different size than requested (e.g. 4K not
      // supported on the selected lens) — encode what it actually delivers.
      console.log('[stream] step: startCapture');
      const capture = await CameraService.startCapture(cameraId, this.width, this.height, config.fps);
      const outWidth = capture && capture.width > 0 ? capture.width : this.width;
      const outHeight = capture && capture.height > 0 ? capture.height : this.height;
      console.log(`[stream] capture ok: ${outWidth}x${outHeight}`);
      if (config.audio !== false) {
        console.log('[stream] step: startAudio');
        await AudioService.startRecording();
      }
      console.log('[stream] step: initEncoder');
      try {
        await EncoderService.initEncoder(outWidth, outHeight, config.bitrate, config.fps);
        console.log('[stream] encoder ready');
      } catch (encError) {
        // Non-fatal: the WebRTC track encodes natively (org.webrtc software
        // encoder). The MediaCodec encoder is only used by the USB/raw path.
        const enc = encError as { message?: string; code?: string };
        console.warn(
          '[stream] encoder init failed (non-fatal, WebRTC encodes natively):',
          `code=${JSON.stringify(enc?.code)}`,
          `message=${JSON.stringify(enc?.message)}`,
        );
      }
      console.log('[stream] step: createPeerConnection');
      await WebRTCService.createPeerConnection(this.iceServers);
      console.log('[stream] step: addVideoTrack');
      await WebRTCService.addVideoTrack('ojowacam-video');
      if (config.audio !== false) {
        console.log('[stream] step: addAudioTrack');
        await WebRTCService.addAudioTrack('ojowacam-audio');
      }
      console.log('[stream] step: createOffer');
      await WebRTCService.createOffer();
      console.log('[stream] step: sendStartSession');
      const videoConfig: VideoConfig = {
        resolution: `${outWidth}x${outHeight}`, fps: config.fps, codec: config.codec, bitrate: config.bitrate,
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
      const err = error as { message?: string; code?: string; stack?: string } | null;
      console.error(
        '[stream] Failed to start streaming:',
        `message=${JSON.stringify(err?.message)}`,
        `code=${JSON.stringify(err?.code)}`,
        `string=${String(error)}`,
        `stack=${err?.stack ?? 'n/a'}`,
      );
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

  /**
   * Start the Wireless Mic broadcast: raw microphone PCM is streamed to OBS
   * over the signaling WebSocket (binary frames), no camera/WebRTC involved.
   */
  async startAudioBroadcast(): Promise<boolean> {
    if (this.audioBroadcasting) { console.warn('Audio broadcast already running'); return false; }
    try {
      this.state.error = null;
      if (Platform.OS !== 'android') {
        // The PCM-over-WebSocket capture path (s16le 48k stereo emission) is
        // implemented natively on Android; fail honestly elsewhere.
        throw new Error('The Wireless Mic broadcast is currently Android-only.');
      }
      if (this.isStreaming) {
        throw new Error('Stop the camera stream before starting the Wireless Mic.');
      }
      await connectionConfig.load();
      this.config.signalingUrl = connectionConfig.getSignalingUrl();
      signalingService.setServerUrl(this.config.signalingUrl);
      if (!signalingService.isConnected()) {
        await signalingService.connect();
      }
      if (!authService.isAuthenticated()) {
        if (!this.config.autoPair) {
          throw new Error('Not authenticated. Session required before streaming.');
        }
        await this.requestPairing();
        const paired = await this.waitForPairing(30 * 1000);
        if (!paired || !authService.isAuthenticated()) {
          throw new Error('Unable to establish a session with OBS.');
        }
      }
      if (Platform.OS === 'android') {
        const perms = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        if (perms[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error('Microphone permission is required to broadcast audio.');
        }
      }
      await streamSettings.load();
      await AudioService.setNoiseSuppression(streamSettings.isNoiseSuppressionEnabled());
      await AudioService.setGain(streamSettings.getGainBoost());
      AudioService.setOnAudioData((pcm) => {
        // Muted: send nothing — silence is the absence of frames, never faked.
        if (this.audioMuted) return;
        signalingService.sendAudioFrame(pcm);
      });
      const started = await AudioService.startRecording();
      if (!started) throw new Error('Unable to start microphone capture.');
      this.audioBroadcasting = true;
      this.audioMuted = false;
      this.state.isAudioBroadcasting = true;
      this.state.error = null;
      this.notifyStateChange();
      console.log('Wireless Mic broadcast started');
      return true;
    } catch (error) {
      console.error('Failed to start audio broadcast:', error);
      const message = error instanceof Error ? error.message : 'Failed to start audio broadcast';
      await this.stopAudioBroadcast();
      this.state.error = message;
      this.notifyStateChange();
      return false;
    }
  }

  async stopAudioBroadcast(): Promise<boolean> {
    const wasBroadcasting = this.audioBroadcasting;
    AudioService.setOnAudioData(null);
    let failure: Error | null = null;
    try {
      await AudioService.stopRecording();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    this.audioBroadcasting = false;
    this.audioMuted = false;
    this.state.isAudioBroadcasting = false;
    this.state.error = failure ? failure.message : null;
    this.notifyStateChange();
    if (!failure && wasBroadcasting) console.log('Wireless Mic broadcast stopped');
    return failure === null;
  }

  /** Mute/unmute the Wireless Mic. Muted = no frames sent (real silence). */
  setAudioMuted(muted: boolean): void {
    this.audioMuted = muted;
  }

  async handleIncomingSignalingMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'ANSWER': await WebRTCService.setRemoteDescription('answer', message.sdp); break;
      case 'ICE_CANDIDATE': await WebRTCService.addIceCandidate(message.candidate); break;
      case 'PAIRING_RESPONSE':
        this.state.isAuthenticated = authService.isAuthenticated();
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
  getIsAudioBroadcasting(): boolean { return this.audioBroadcasting; }
  getIsAudioMuted(): boolean { return this.audioMuted; }
  getCurrentCameraId(): string | null { return this.currentCameraId; }
  getConfig(): StreamConfig { return { ...this.streamConfig }; }
  getSignalingState(): any { return signalingService.getState(); }
  isAuthenticated(): boolean { return authService.isAuthenticated(); }
  isPaired(): boolean { return authService.isPaired(); }

  private notifyStateChange(): void {
    this.state.isConnected = signalingService.isConnected();
    this.state.isAuthenticated = authService.isAuthenticated();
    this.state.sessionTTL = authService.getSessionTTL();
    this.onStateChange?.(this.getState());
  }
}

export const streamingService = new StreamingService();
