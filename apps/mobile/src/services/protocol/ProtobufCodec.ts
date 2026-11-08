/**
 * ProtobufCodec.ts
 * 
 * Minimal Protocol Buffers wire-format encoder/decoder.
 * 
 * Supports Varint (wire type 0) and Length-delimited (wire type 2)
 * needed by Ojowacam protocol messages. Provides protobuf-compatible binary
 * encoding without the protobufjs dependency.
 * 
 * Protocol reference: docs/protocols/PROTOCOL.md
 * Message types: src/services/protocol/messageTypes.ts
 */

import {
  DeviceAnnouncement,
  StartSession,
  ControlCommand,
  Capabilities,
  VideoConfig,
  AudioConfig,
  FieldTags,
  WireType,
  ProtocolMessage,
} from './messageTypes';

// ---------------------------------------------------------------------------
// Varint encoding/decoding
// ---------------------------------------------------------------------------

export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return new Uint8Array(bytes);
}

export function decodeVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = offset;
  let byte: number;

  do {
    byte = data[i];
    result |= (byte & 0x7f) << shift;
    shift += 7;
    i++;
  } while (byte & 0x80 && i < data.length);

  return [result >>> 0, i - offset];

function encodeCapabilities(caps: Capabilities): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeField(FieldTags.Capabilities_video, WireType.Varint, caps.video ? 1 : 0));
  parts.push(encodeField(FieldTags.Capabilities_audio, WireType.Varint, caps.audio ? 1 : 0));
  for (const res of caps.resolutions) {
    parts.push(encodeField(FieldTags.Capabilities_resolutions, WireType.LengthDelimited, res));
  }
  for (const fps of caps.frameRates) {
    parts.push(encodeField(FieldTags.Capabilities_frameRates, WireType.Varint, fps));
  }
  return concatUint8Arrays(parts);
}

function encodeVideoConfig(config: VideoConfig): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeField(FieldTags.VideoConfig_resolution, WireType.LengthDelimited, config.resolution));
  parts.push(encodeField(FieldTags.VideoConfig_fps, WireType.Varint, config.fps));
  parts.push(encodeField(FieldTags.VideoConfig_codec, WireType.LengthDelimited, config.codec));
  parts.push(encodeField(FieldTags.VideoConfig_bitrate, WireType.Varint, config.bitrate));
  return concatUint8Arrays(parts);
}

function encodeAudioConfig(config: AudioConfig): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeField(FieldTags.AudioConfig_codec, WireType.LengthDelimited, config.codec));
  parts.push(encodeField(FieldTags.AudioConfig_sampleRate, WireType.Varint, config.sampleRate));
  parts.push(encodeField(FieldTags.AudioConfig_channels, WireType.Varint, config.channels));
  return concatUint8Arrays(parts);
}

function encodeDeviceAnnouncement(msg: DeviceAnnouncement): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeField(FieldTags.DeviceAnnouncement_deviceId, WireType.LengthDelimited, msg.deviceId));
  parts.push(encodeField(FieldTags.DeviceAnnouncement_deviceName, WireType.LengthDelimited, msg.deviceName));
  const capsBytes = encodeCapabilities(msg.capabilities);
  parts.push(encodeField(FieldTags.DeviceAnnouncement_capabilities, WireType.LengthDelimited, capsBytes));
  return concatUint8Arrays(parts);
}

function encodeStartSession(msg: StartSession): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeField(FieldTags.StartSession_sessionId, WireType.LengthDelimited, msg.sessionId));
  const videoBytes = encodeVideoConfig(msg.video);
  parts.push(encodeField(FieldTags.StartSession_video, WireType.LengthDelimited, videoBytes));
  const audioBytes = encodeAudioConfig(msg.audio);
  parts.push(encodeField(FieldTags.StartSession_audio, WireType.LengthDelimited, audioBytes));
  return concatUint8Arrays(parts);
}


function decodeVarintValue(data: Uint8Array, offset: number): [number, number] {
  return decodeVarint(data, offset);
}

function decodeString(data: Uint8Array, offset: number): [string, number] {
  const [length, bytesRead] = decodeVarint(data, offset);
  const start = offset + bytesRead;
  const decoder = new TextDecoder();
  const str = decoder.decode(data.slice(start, start + length));
  return [str, bytesRead + length];
}

function decodeBytes(data: Uint8Array, offset: number): [Uint8Array, number] {
  const [length, bytesRead] = decodeVarint(data, offset);
  const start = offset + bytesRead;
  const bytes = data.slice(start, start + length);
  return [bytes, bytesRead + length];
}

function decodeField(data: Uint8Array, offset: number): [number, number, unknown, number] {
  const [key, keyBytes] = decodeVarint(data, offset);
  const fieldNumber = key >>> 3;
  const wireType = key & 0x7;
  const valueStart = offset + keyBytes;

  let value: unknown;
  let valueBytes: number;

  switch (wireType) {
    case WireType.Varint:
      [value, valueBytes] = decodeVarint(data, valueStart);
      break;
    case WireType.LengthDelimited:
      [value, valueBytes] = decodeBytes(data, valueStart);

function decodeCapabilities(data: Uint8Array, offset: number, end: number): Capabilities {
  const caps: Capabilities = {
    video: false,
    audio: false,
    resolutions: [],
    frameRates: [],
  };

  while (offset < end) {
    const [fieldNumber, wireType, value, bytesRead] = decodeField(data, offset);
    offset += bytesRead;

    switch (fieldNumber) {
      case FieldTags.Capabilities_video:
        caps.video = (value as number) === 1;
        break;
      case FieldTags.Capabilities_audio:
        caps.audio = (value as number) === 1;
        break;
      case FieldTags.Capabilities_resolutions:
        caps.resolutions.push(new TextDecoder().decode(value as Uint8Array));
        break;
      case FieldTags.Capabilities_frameRates:
        caps.frameRates.push(value as number);
        break;
    }
  }

  return caps;
}

function decodeVideoConfig(data: Uint8Array, offset: number, end: number): VideoConfig {
  const config: VideoConfig = {
    resolution: '',
    fps: 30,
    codec: 'H264',
    bitrate: 0,
  };

  while (offset < end) {
    const [fieldNumber, wireType, value, bytesRead] = decodeField(data, offset);
    offset += bytesRead;

    switch (fieldNumber) {
      case FieldTags.VideoConfig_resolution:
        config.resolution = new TextDecoder().decode(value as Uint8Array);
        break;
      case FieldTags.VideoConfig_fps:
        config.fps = value as number;
        break;
      case FieldTags.VideoConfig_codec:
        config.codec = new TextDecoder().decode(value as Uint8Array);
        break;
      case FieldTags.VideoConfig_bitrate:
        config.bitrate = value as number;
        break;
    }
  }

  return config;

function decodeAudioConfig(data: Uint8Array, offset: number, end: number): AudioConfig {
  const config: AudioConfig = {
    codec: 'OPUS',
    sampleRate: 48000,
    channels: 2,
  };

  while (offset < end) {
    const [fieldNumber, wireType, value, bytesRead] = decodeField(data, offset);
    offset += bytesRead;

    switch (fieldNumber) {
      case FieldTags.AudioConfig_codec:
        config.codec = new TextDecoder().decode(value as Uint8Array);
        break;
      case FieldTags.AudioConfig_sampleRate:
        config.sampleRate = value as number;
        break;
      case FieldTags.AudioConfig_channels:
        config.channels = value as number;
        break;
    }
  }

  return config;
}

function decodeDeviceAnnouncement(data: Uint8Array): DeviceAnnouncement {
  let deviceId = '';
  let deviceName = '';
  let capabilities: Capabilities = {
    video: false,
    audio: false,
    resolutions: [],
    frameRates: [],
  };

  let offset = 0;
  while (offset < data.length) {
    const [fieldNumber, wireType, value, bytesRead] = decodeField(data, offset);
    offset += bytesRead;

    switch (fieldNumber) {
      case FieldTags.DeviceAnnouncement_deviceId:
        deviceId = new TextDecoder().decode(value as Uint8Array);
        break;
      case FieldTags.DeviceAnnouncement_deviceName:
        deviceName = new TextDecoder().decode(value as Uint8Array);
        break;
      case FieldTags.DeviceAnnouncement_capabilities:
        capabilities = decodeCapabilities(
          value as Uint8Array,
          0,
          (value as Uint8Array).length
        );
        break;
    }
  }

  return {
    type: 'DEVICE_ANNOUNCEMENT',
    deviceId,
    deviceName,
    capabilities,
  };
}

function decodeStartSession(data: Uint8Array): StartSession {
  let sessionId = '';
  let video: VideoConfig = { resolution: '', fps: 30, codec: 'H264', bitrate: 0 };
  let audio: AudioConfig = { codec: 'OPUS', sampleRate: 48000, channels: 2 };

  let offset = 0;
  while (offset < data.length) {
    const [fieldNumber, wireType, value, bytesRead] = decodeField(data, offset);
    offset += bytesRead;

    switch (fieldNumber) {
      case FieldTags.StartSession_sessionId:
        sessionId = new TextDecoder().decode(value as Uint8Array);
        break;
      case FieldTags.StartSession_video:
        video = decodeVideoConfig(value as Uint8Array, 0, (value as Uint8Array).length);
        break;
      case FieldTags.StartSession_audio:
        audio = decodeAudioConfig(value as Uint8Array, 0, (value as Uint8Array).length);
        break;
    }
  }

  return {
    type: 'START_SESSION',
    sessionId,
    video,
    audio,
  };
}

function decodeControlCommand(data: Uint8Array): ControlCommand {
  const cmd: ControlCommand = {
    type: 'CONTROL_COMMAND',
    command: 'orientation',
  };

  let offset = 0;
  while (offset < data.length) {
    const [fieldNumber, wireType, value, bytesRead] = decodeField(data, offset);
    offset += bytesRead;

    switch (fieldNumber) {
      case FieldTags.ControlCommand_type:
        cmd.command = new TextDecoder().decode(value as Uint8Array) as ControlCommand['command'];
        break;
      case FieldTags.ControlCommand_zoom:
        cmd.zoom = value as number;
        break;
      case FieldTags.ControlCommand_focus:
        cmd.focus = (value as number) === 1;
        break;
      case FieldTags.ControlCommand_torch:
        cmd.torch = (value as number) === 1;
        break;
      case FieldTags.ControlCommand_orientation:
        cmd.orientation = new TextDecoder().decode(value as Uint8Array) as ControlCommand['orientation'];
        break;
    }
  }

  return cmd;
}

export function decodeMessage(data: Uint8Array, expectedType?: string): ProtocolMessage {
  if (!expectedType && data.length > 0) {
    const [key] = decodeVarint(data, 0);
    const fieldNumber = key >>> 3;
    expectedType = 'DEVICE_ANNOUNCEMENT';
  }

  switch (expectedType) {
    case 'DEVICE_ANNOUNCEMENT':
      return decodeDeviceAnnouncement(data);
    case 'START_SESSION':
      return decodeStartSession(data);
    case 'CONTROL_COMMAND':
      return decodeControlCommand(data);
    default:
      throw new Error(`Unknown or unsupported message type: ${expectedType}`);
  }
}

export function decodeMessageBase64(
  base64: string,
  expectedType?: string
): ProtocolMessage {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return decodeMessage(bytes, expectedType);
}

}

      break;
    default:
      throw new Error(`Unsupported wire type for decoding: ${wireType}`);
  }

  return [fieldNumber, wireType, value, keyBytes + valueBytes];
}

function encodeControlCommand(msg: ControlCommand): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeField(FieldTags.ControlCommand_type, WireType.LengthDelimited, msg.command));
  if (msg.zoom !== undefined) {
    parts.push(encodeField(FieldTags.ControlCommand_zoom, WireType.Varint, msg.zoom));
  }
  if (msg.focus !== undefined) {
    parts.push(encodeField(FieldTags.ControlCommand_focus, WireType.Varint, msg.focus ? 1 : 0));
  }
  if (msg.torch !== undefined) {
    parts.push(encodeField(FieldTags.ControlCommand_torch, WireType.Varint, msg.torch ? 1 : 0));
  }
  if (msg.orientation !== undefined) {
    parts.push(encodeField(FieldTags.ControlCommand_orientation, WireType.LengthDelimited, msg.orientation));
  }
  return concatUint8Arrays(parts);
}

export function encodeMessage(msg: ProtocolMessage): Uint8Array {
  switch (msg.type) {
    case 'DEVICE_ANNOUNCEMENT':
      return encodeDeviceAnnouncement(msg);
    case 'START_SESSION':
      return encodeStartSession(msg);
    case 'CONTROL_COMMAND':
      return encodeControlCommand(msg);
    default:
      throw new Error(`Unknown message type: ${(msg as { type: string }).type}`);
  }
}

export function encodeMessageBase64(msg: ProtocolMessage): string {
  const bytes = encodeMessage(msg);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

}

function encodeFieldKey(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeValue(value: unknown, wireType: number): Uint8Array {
  switch (wireType) {
    case WireType.Varint:
      return encodeVarint(typeof value === 'boolean' ? (value ? 1 : 0) : value as number);
    case WireType.LengthDelimited:
      if (typeof value === 'string') {
        return encodeString(value);
      }
      if (value instanceof Uint8Array) {
        return encodeBytes(value);
      }
      throw new Error(`Unsupported length-delimited value type: ${typeof value}`);
    default:
      throw new Error(`Unsupported wire type for encoding: ${wireType}`);
  }
}

function encodeString(value: string): Uint8Array {
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(value);
  const lengthBytes = encodeVarint(utf8Bytes.length);
  const result = new Uint8Array(lengthBytes.length + utf8Bytes.length);
  result.set(lengthBytes, 0);
  result.set(utf8Bytes, lengthBytes.length);
  return result;
}

function encodeBytes(value: Uint8Array): Uint8Array {
  const lengthBytes = encodeVarint(value.length);
  const result = new Uint8Array(lengthBytes.length + value.length);
  result.set(lengthBytes, 0);
  result.set(value, lengthBytes.length);
  return result;
}

function encodeField(fieldNumber: number, wireType: number, value: unknown): Uint8Array {
  const key = encodeFieldKey(fieldNumber, wireType);
  const valueBytes = encodeValue(value, wireType);
  const result = new Uint8Array(key.length + valueBytes.length);
  result.set(key, 0);
  result.set(valueBytes, key.length);
  return result;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
