import { NativeModules, NativeEventEmitter, DeviceEventEmitter, type EmitterSubscription } from 'react-native';

const { OjowacamCamera, OjowacamAudio, OjowacamEncoder, OjowacamWebRTC } = NativeModules;

const eventEmitter = new NativeEventEmitter();

export interface CameraDevice {
  id: string;
  facing: 'back' | 'front';
}

export interface StreamConfig {
  resolution: string;
  fps: number;
  bitrate: number;
  codec: string;
}

export class CameraService {
  static async getAvailableCameras(): Promise<CameraDevice[]> {
    const cameras = await OjowacamCamera.getAvailableCameras();
    return cameras as CameraDevice[];
  }

  static async startCapture(cameraId: string, width: number, height: number, fps: number): Promise<boolean> {
    return OjowacamCamera.startCapture(cameraId, width, height, fps);
  }

  static async stopCapture(): Promise<boolean> {
    return OjowacamCamera.stopCapture();
  }

  static async switchCamera(): Promise<string> {
    return OjowacamCamera.switchCamera();
  }

  static async setTorch(enabled: boolean): Promise<boolean> {
    return OjowacamCamera.setTorch(enabled);
  }

  static async setZoom(zoomLevel: number): Promise<boolean> {
    return OjowacamCamera.setZoom(zoomLevel);
  }

  static async setFocusMode(mode: string): Promise<boolean> {
    return OjowacamCamera.setFocusMode(mode);
  }
}

export class AudioService {
  static async startRecording(): Promise<boolean> {
    return OjowacamAudio.startRecording();
  }

  static async stopRecording(): Promise<boolean> {
    return OjowacamAudio.stopRecording();
  }

  static async getAudioLevels(): Promise<number> {
    return OjowacamAudio.getAudioLevels();
  }
}

export class EncoderService {
  private static onEncodedFrameCallback: ((data: Uint8Array) => void) | null = null;
  private static subscriptions: EmitterSubscription[] = [];
  private static eventsBound = false;

  static async initEncoder(width: number, height: number, bitrate: number, fps: number): Promise<boolean> {
    this.bindNativeEvents();
    return OjowacamEncoder.initEncoder(width, height, bitrate, fps);
  }

  static async releaseEncoder(): Promise<boolean> {
    return OjowacamEncoder.releaseEncoder();
  }

  static setOnEncodedFrame(callback: (data: Uint8Array) => void) {
    this.onEncodedFrameCallback = callback;
    this.bindNativeEvents();
  }

  static notifyEncodedFrame(data: Uint8Array) {
    this.onEncodedFrameCallback?.(data);
  }

  private static bindNativeEvents(): void {
    if (this.eventsBound) return;
    this.eventsBound = true;
    const handle = (event: { data?: number[] | Uint8Array | string }) => {
      if (!event || event.data == null) return;
      const raw = event.data;
      const bytes =
        typeof raw === 'string'
          ? Uint8Array.from(raw, (ch) => ch.charCodeAt(0))
          : raw instanceof Uint8Array
            ? raw
            : Uint8Array.from(raw);
      this.notifyEncodedFrame(bytes);
    };
    // iOS RCTEventEmitter + Android RCTDeviceEventEmitter both surface here.
    this.subscriptions.push(
      DeviceEventEmitter.addListener('onEncodedFrame', handle),
      DeviceEventEmitter.addListener('onEncodedVideoFrame', handle),
    );
  }
}

export class WebRTCService {
  private static onLocalSdpCallback: ((type: string, sdp: string) => void) | null = null;
  private static onIceCandidateCallback: ((candidate: string) => void) | null = null;
  private static onConnectionStateChangeCallback: ((state: string) => void) | null = null;
  private static subscriptions: EmitterSubscription[] = [];
  private static eventsBound = false;
  private static webRtcEmitter: NativeEventEmitter | null = null;

  static async initWebRTC(): Promise<boolean> {
    this.bindNativeEvents();
    return OjowacamWebRTC.initWebRTC();
  }

  static async createPeerConnection(iceServers: string[]): Promise<boolean> {
    this.bindNativeEvents();
    const servers = iceServers.join(',');
    return OjowacamWebRTC.createPeerConnection(servers);
  }

  static async createOffer(): Promise<boolean> {
    this.bindNativeEvents();
    return OjowacamWebRTC.createOffer();
  }

  static async setRemoteDescription(type: string, sdp: string): Promise<boolean> {
    return OjowacamWebRTC.setRemoteDescription(type, sdp);
  }

  static async addIceCandidate(candidate: string): Promise<boolean> {
    return OjowacamWebRTC.addIceCandidate(candidate);
  }

  static async addVideoTrack(track: any): Promise<boolean> {
    return OjowacamWebRTC.addVideoTrack(track);
  }

  static async addAudioTrack(track: any): Promise<boolean> {
    return OjowacamWebRTC.addAudioTrack(track);
  }

  static async closeConnection(): Promise<boolean> {
    return OjowacamWebRTC.closeConnection();
  }

  static onLocalSdp(callback: (type: string, sdp: string) => void) {
    this.onLocalSdpCallback = callback;
    this.bindNativeEvents();
  }

  static onIceCandidate(callback: (candidate: string) => void) {
    this.onIceCandidateCallback = callback;
    this.bindNativeEvents();
  }

  static onConnectionStateChange(callback: (state: string) => void) {
    this.onConnectionStateChangeCallback = callback;
    this.bindNativeEvents();
  }

  static notifyLocalSdp(type: string, sdp: string) {
    this.onLocalSdpCallback?.(type, sdp);
  }

  static notifyIceCandidate(candidate: string) {
    this.onIceCandidateCallback?.(candidate);
  }

  static notifyConnectionStateChange(state: string) {
    this.onConnectionStateChangeCallback?.(state);
  }

  /**
   * Subscribe once to native WebRTC events.
   * iOS: RCTEventEmitter.sendEvent → NativeEventEmitter / DeviceEventEmitter
   * Android: RCTDeviceEventEmitter.emit → DeviceEventEmitter
   */
  private static bindNativeEvents(): void {
    if (this.eventsBound || !OjowacamWebRTC) return;
    this.eventsBound = true;

    // Module-scoped emitter (iOS RCTEventEmitter); Android also implements addListener/removeListeners.
    try {
      this.webRtcEmitter = new NativeEventEmitter(OjowacamWebRTC);
    } catch {
      this.webRtcEmitter = null;
    }

    const onLocalSdp = (event: { type?: string; sdp?: string } | null | undefined) => {
      if (!event || typeof event.sdp !== 'string') return;
      this.notifyLocalSdp(event.type ?? 'offer', event.sdp);
    };
    const onIceCandidate = (event: { candidate?: string } | null | undefined) => {
      if (!event || typeof event.candidate !== 'string') return;
      this.notifyIceCandidate(event.candidate);
    };
    const onConnectionStateChange = (event: { state?: string | number } | null | undefined) => {
      if (!event || event.state == null) return;
      this.notifyConnectionStateChange(String(event.state));
    };

    const sources: Array<{ addListener: NativeEventEmitter['addListener'] }> = [];
    if (this.webRtcEmitter) sources.push(this.webRtcEmitter);
    // DeviceEventEmitter covers Android emits and is a safe fallback; dedupe by only
    // adding it when no module emitter is available (iOS module emitter is preferred).
    if (!this.webRtcEmitter) {
      sources.push(DeviceEventEmitter as unknown as { addListener: NativeEventEmitter['addListener'] });
    } else {
      // On Android, NativeEventEmitter forwards to the same stream as DeviceEventEmitter
      // once addListener/removeListeners exist on the module — no second subscription needed.
      // Still bind DeviceEventEmitter for Android builds where the module emitter is a no-op.
      // Use both but guard double-fire with a short dedupe window per event.
    }

    // Always bind DeviceEventEmitter as well for Android reliability; dedupe payloads.
    const seen = new Map<string, number>();
    const deduped = (key: string, run: () => void) => {
      const now = Date.now();
      const last = seen.get(key) ?? 0;
      if (now - last < 50) return;
      seen.set(key, now);
      run();
    };

    const subscribe = (
      name: string,
      handler: (payload: any) => void,
    ) => {
      const wrapped = (payload: any) => deduped(`${name}:${JSON.stringify(payload ?? null)}`, () => handler(payload));
      if (this.webRtcEmitter) {
        this.subscriptions.push(this.webRtcEmitter.addListener(name, wrapped));
      }
      this.subscriptions.push(DeviceEventEmitter.addListener(name, wrapped));
    };

    subscribe('onLocalSdp', onLocalSdp);
    subscribe('onIceCandidate', onIceCandidate);
    subscribe('onConnectionStateChange', onConnectionStateChange);
  }

  static unbindNativeEvents(): void {
    for (const sub of this.subscriptions) {
      try {
        sub.remove();
      } catch {
        // already removed
      }
    }
    this.subscriptions = [];
    this.eventsBound = false;
    this.webRtcEmitter = null;
  }
}

export default {
  CameraService,
  AudioService,
  EncoderService,
  WebRTCService
};
