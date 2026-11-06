import { NativeModules, NativeEventEmitter } from 'react-native';

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

  static async initEncoder(width: number, height: number, bitrate: number, fps: number): Promise<boolean> {
    return OjowacamEncoder.initEncoder(width, height, bitrate, fps);
  }

  static async releaseEncoder(): Promise<boolean> {
    return OjowacamEncoder.releaseEncoder();
  }

  static setOnEncodedFrame(callback: (data: Uint8Array) => void) {
    this.onEncodedFrameCallback = callback;
  }

  static notifyEncodedFrame(data: Uint8Array) {
    this.onEncodedFrameCallback?.(data);
  }
}

export class WebRTCService {
  private static onLocalSdpCallback: ((type: string, sdp: string) => void) | null = null;
  private static onIceCandidateCallback: ((candidate: string) => void) | null = null;
  private static onConnectionStateChangeCallback: ((state: string) => void) | null = null;

  static async initWebRTC(): Promise<boolean> {
    return OjowacamWebRTC.initWebRTC();
  }

  static async createPeerConnection(iceServers: string[]): Promise<boolean> {
    const servers = iceServers.join(',');
    return OjowacamWebRTC.createPeerConnection(servers);
  }

  static async createOffer(): Promise<boolean> {
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
  }

  static onIceCandidate(callback: (candidate: string) => void) {
    this.onIceCandidateCallback = callback;
  }

  static onConnectionStateChange(callback: (state: string) => void) {
    this.onConnectionStateChangeCallback = callback;
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
}

export default {
  CameraService,
  AudioService,
  EncoderService,
  WebRTCService
};
