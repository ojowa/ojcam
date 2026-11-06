import { CameraService, AudioService, EncoderService, WebRTCService } from './native/modules';
import { CameraDevice, StreamConfig } from './native/modules';

export class StreamingService {
  private isStreaming = false;
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

  async initialize(): Promise<boolean> {
    try {
      await WebRTCService.initWebRTC();
      await EncoderService.initEncoder(
        this.streamConfig.width,
        this.streamConfig.height,
        this.streamConfig.bitrate,
        this.streamConfig.fps
      );

      // Set up callbacks
      WebRTCService.onLocalSdp((type, sdp) => {
        // Send SDP to desktop via signaling
        this.sendSignalingMessage({ type: 'OFFER', sdp, sdpType: type });
      });

      WebRTCService.onIceCandidate((candidate) => {
        this.sendSignalingMessage({ type: 'ICE_CANDIDATE', candidate });
      });

      WebRTCService.onConnectionStateChange((state) => {
        console.log('WebRTC connection state:', state);
        if (state === 'DISCONNECTED' || state === 'FAILED') {
          this.isStreaming = false;
        }
      });

      return true;
    } catch (error) {
      console.error('Failed to initialize streaming:', error);
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

  async startStreaming(cameraId: string, config: StreamConfig, signalingUrl: string): Promise<boolean> {
    if (this.isStreaming) {
      console.warn('Already streaming');
      return false;
    }

    try {
      this.streamConfig = config;
      this.currentCameraId = cameraId;

      // Start camera capture
      await CameraService.startCapture(cameraId, this.width, this.height, config.fps);

      // Start audio recording
      await AudioService.startRecording();

      // Initialize encoder
      await EncoderService.initEncoder(this.width, this.height, config.bitrate, config.fps);

      // Set up WebRTC
      await WebRTCService.createPeerConnection(this.iceServers);

      // Create and send offer
      await WebRTCService.createOffer();

      this.isStreaming = true;
      console.log('Streaming started');
      return true;
    } catch (error) {
      console.error('Failed to start streaming:', error);
      await this.stopStreaming();
      return false;
    }
  }

  async stopStreaming(): Promise<boolean> {
    if (!this.isStreaming) {
      return true;
    }

    try {
      await WebRTCService.closeConnection();
      await EncoderService.releaseEncoder();
      await AudioService.stopRecording();
      await CameraService.stopCapture();

      this.isStreaming = false;
      this.currentCameraId = null;
      console.log('Streaming stopped');
      return true;
    } catch (error) {
      console.error('Failed to stop streaming:', error);
      return false;
    }
  }

  async handleSignalingMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'ANSWER':
        await WebRTCService.setRemoteDescription('answer', message.sdp);
        break;
      case 'ICE_CANDIDATE':
        await WebRTCService.addIceCandidate(message.candidate);
        break;
    }
  }

  private async sendSignalingMessage(message: any): Promise<void> {
    // TODO: Send via WebSocket to desktop
    console.log('Signaling message:', message);
  }

  getIsStreaming(): boolean {
    return this.isStreaming;
  }

  getCurrentCameraId(): string | null {
    return this.currentCameraId;
  }

  getConfig(): StreamConfig {
    return { ...this.streamConfig };
  }
}

export const streamingService = new StreamingService();
