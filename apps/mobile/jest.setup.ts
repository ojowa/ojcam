/**
 * jest.setup.ts
 * Test setup for Ojowacam mobile app unit tests.
 */

import { jest } from '@jest/globals';

// Mock React Native modules
jest.mock('react-native', () => ({
  NativeModules: {
    OjowacamCamera: {
      getAvailableCameras: jest.fn(),
      startCapture: jest.fn(),
      stopCapture: jest.fn(),
      switchCamera: jest.fn(),
      setTorch: jest.fn(),
      setZoom: jest.fn(),
      setFocusMode: jest.fn(),
    },
    OjowacamAudio: {
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      getAudioLevels: jest.fn(),
    },
    OjowacamEncoder: {
      initEncoder: jest.fn(),
      releaseEncoder: jest.fn(),
    },
    OjowacamWebRTC: {
      initWebRTC: jest.fn(),
      createPeerConnection: jest.fn(),
      createOffer: jest.fn(),
      setRemoteDescription: jest.fn(),
      addIceCandidate: jest.fn(),
      addVideoTrack: jest.fn(),
      addAudioTrack: jest.fn(),
      closeConnection: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    },
    OjowacamUSB: {
      initialize: jest.fn(),
      startUSB: jest.fn(),
      stopUSB: jest.fn(),
      getUSBDevices: jest.fn(),
      sendCommand: jest.fn(),
    },
  },
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  })),
  Platform: {
    OS: 'ios',
    select: jest.fn((obj: any) => obj.ios || obj.default),
  },
  AppRegistry: {},
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Mock WebRTC
jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: jest.fn(),
  RTCSessionDescription: jest.fn(),
  RTCIceCandidate: jest.fn(),
  MediaStream: jest.fn(),
}));
