/**
 * ProtobufCodec.test.ts
 * Unit tests for the ProtobufCodec module.
 */

import {
  encodeMessage,
  decodeMessage,
  encodeMessageBase64,
  decodeMessageBase64,
  createDeviceAnnouncement,
  createStartSession,
  createControlCommand,
  type DeviceAnnouncement,
  type StartSession,
  type ControlCommand,
} from '../services/protocol/ProtobufCodec';

describe('ProtobufCodec', () => {
  describe('DeviceAnnouncement', () => {
    it('should encode and decode a DeviceAnnouncement', () => {
      const msg: DeviceAnnouncement = {
        type: 'DEVICE_ANNOUNCEMENT',
        deviceId: 'mobilecam-test-001',
        deviceName: 'Test Phone',
        capabilities: {
          video: true,
          audio: true,
          resolutions: ['1280x720', '1920x1080'],
          frameRates: [30, 60],
        },
      };

      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded, 'DEVICE_ANNOUNCEMENT') as DeviceAnnouncement;

      expect(decoded.type).toBe('DEVICE_ANNOUNCEMENT');
      expect(decoded.deviceId).toBe(msg.deviceId);
      expect(decoded.deviceName).toBe(msg.deviceName);
      expect(decoded.capabilities.video).toBe(true);
      expect(decoded.capabilities.audio).toBe(true);
      expect(decoded.capabilities.resolutions).toEqual(['1280x720', '1920x1080']);
      expect(decoded.capabilities.frameRates).toEqual([30, 60]);
    });

    it('should encode to base64 and decode back', () => {
      const msg: DeviceAnnouncement = {
        type: 'DEVICE_ANNOUNCEMENT',
        deviceId: 'mobilecam-test-002',
        deviceName: 'Test Phone 2',
        capabilities: {
          video: true,
          audio: false,
          resolutions: ['3840x2160'],
          frameRates: [30],
        },
      };

      const base64 = encodeMessageBase64(msg);
      const decoded = decodeMessageBase64(base64, 'DEVICE_ANNOUNCEMENT') as DeviceAnnouncement;

      expect(decoded.deviceId).toBe(msg.deviceId);
      expect(decoded.deviceName).toBe(msg.deviceName);
      expect(decoded.capabilities.video).toBe(true);
      expect(decoded.capabilities.audio).toBe(false);
    });
  });

  describe('StartSession', () => {
    it('should encode and decode a StartSession', () => {
      const msg: StartSession = {
        type: 'START_SESSION',
        sessionId: 'session-001',
        video: {
          resolution: '1920x1080',
          fps: 30,
          codec: 'H264',
          bitrate: 8000000,
        },
        audio: {
          codec: 'OPUS',
          sampleRate: 48000,
          channels: 2,
        },
      };

      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded, 'START_SESSION') as StartSession;

      expect(decoded.type).toBe('START_SESSION');
      expect(decoded.sessionId).toBe(msg.sessionId);
      expect(decoded.video.resolution).toBe(msg.video.resolution);
      expect(decoded.video.fps).toBe(msg.video.fps);
      expect(decoded.video.codec).toBe(msg.video.codec);
      expect(decoded.video.bitrate).toBe(msg.video.bitrate);
      expect(decoded.audio.codec).toBe(msg.audio.codec);
      expect(decoded.audio.sampleRate).toBe(msg.audio.sampleRate);
      expect(decoded.audio.channels).toBe(msg.audio.channels);
    });
  });

  describe('ControlCommand', () => {
    it('should encode and decode a ControlCommand with zoom', () => {
      const msg: ControlCommand = {
        type: 'CONTROL_COMMAND',
        command: 'zoom',
        zoom: 2.0,
      };

      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded, 'CONTROL_COMMAND') as ControlCommand;

      expect(decoded.type).toBe('CONTROL_COMMAND');
      expect(decoded.command).toBe('zoom');
      expect(decoded.zoom).toBe(2.0);
    });

    it('should encode and decode a ControlCommand with torch', () => {
      const msg: ControlCommand = {
        type: 'CONTROL_COMMAND',
        command: 'torch',
        torch: true,
      };

      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded, 'CONTROL_COMMAND') as ControlCommand;

      expect(decoded.type).toBe('CONTROL_COMMAND');
      expect(decoded.command).toBe('torch');
      expect(decoded.torch).toBe(true);
    });
  });

  describe('create helpers', () => {
    it('createDeviceAnnouncement should create valid message', () => {
      const msg = createDeviceAnnouncement('dev-1', 'My Phone', {
        video: true,
        audio: true,
        resolutions: ['1280x720'],
        frameRates: [30],
      });
      expect(msg.type).toBe('DEVICE_ANNOUNCEMENT');
      expect(msg.deviceId).toBe('dev-1');
    });

    it('createStartSession should create valid message', () => {
      const msg = createStartSession('sess-1', {
        resolution: '1080p',
        fps: 60,
        codec: 'H264',
        bitrate: 5000000,
      }, {
        codec: 'OPUS',
        sampleRate: 48000,
        channels: 2,
      });
      expect(msg.type).toBe('START_SESSION');
      expect(msg.sessionId).toBe('sess-1');
    });

    it('createControlCommand should create valid message', () => {
      const msg = createControlCommand('focus', { focus: true });
      expect(msg.type).toBe('CONTROL_COMMAND');
      expect(msg.command).toBe('focus');
      expect(msg.focus).toBe(true);
    });
  });
});
