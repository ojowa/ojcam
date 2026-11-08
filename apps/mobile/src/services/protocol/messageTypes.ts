/**
 * messageTypes.ts
 * 
 * Protocol buffer message schemas for Ojowacam.
 * 
 * These TypeScript interfaces mirror the .proto definitions in
 * packages/protocol/ (device.proto, session.proto, control.proto) and are
 * used by ProtobufCodec.ts for binary encoding/decoding.
 * 
 * Protocol reference: docs/protocols/PROTOCOL.md
 */

export interface Capabilities {
  video: boolean;
  audio: boolean;
  resolutions: string[];
  frameRates: number[];
}

export interface DeviceAnnouncement {
  type: 'DEVICE_ANNOUNCEMENT';
  deviceId: string;
  deviceName: string;
  capabilities: Capabilities;
}

export interface VideoConfig {
  resolution: string;
  fps: number;
  codec: string;
  bitrate: number;
}

export interface AudioConfig {
  codec: string;
  sampleRate: number;
  channels: number;
}

export interface StartSession {
  type: 'START_SESSION';
  sessionId: string;
  video: VideoConfig;
  audio: AudioConfig;
}

export interface ControlCommand {
  type: 'CONTROL_COMMAND';
  command: 'zoom' | 'focus' | 'torch' | 'orientation';
  zoom?: number;
  focus?: boolean;
  torch?: boolean;
  orientation?: 'portrait' | 'landscape' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';
}

// ---------------------------------------------------------------------------
// Union type for all protocol messages
// ---------------------------------------------------------------------------

export type ProtocolMessage =
  | DeviceAnnouncement
  | StartSession
  | ControlCommand;

// ---------------------------------------------------------------------------
// Protobuf field tags (matching packages/protocol/*.proto)
// ---------------------------------------------------------------------------

// device.proto
//   DeviceAnnouncement: device_id=1, device_name=2, capabilities=3
//   Capabilities: video=1, audio=2, resolutions=3, frame_rates=4
// session.proto
//   StartSession: session_id=1, video=2, audio=3
//   VideoConfig: resolution=1, fps=2, codec=3, bitrate=4
//   AudioConfig: codec=1, sample_rate=2, channels=3
// control.proto
//   ControlCommand: type=1, zoom=2, focus=3, torch=4, orientation=5

export const FieldTags = {
  // DeviceAnnouncement
  DeviceAnnouncement_deviceId: 1,
  DeviceAnnouncement_deviceName: 2,
  DeviceAnnouncement_capabilities: 3,
  // Capabilities
  Capabilities_video: 1,
  Capabilities_audio: 2,
  Capabilities_resolutions: 3,
  Capabilities_frameRates: 4,
  // StartSession
  StartSession_sessionId: 1,
  StartSession_video: 2,
  StartSession_audio: 3,
  // VideoConfig
  VideoConfig_resolution: 1,
  VideoConfig_fps: 2,
  VideoConfig_codec: 3,
  VideoConfig_bitrate: 4,
  // AudioConfig
  AudioConfig_codec: 1,
  AudioConfig_sampleRate: 2,
  AudioConfig_channels: 3,
  // ControlCommand
  ControlCommand_type: 1,
  ControlCommand_zoom: 2,
  ControlCommand_focus: 3,
  ControlCommand_torch: 4,
  ControlCommand_orientation: 5,
} as const;

// ---------------------------------------------------------------------------
// Wire types (protobuf)
// ---------------------------------------------------------------------------

export const WireType = {
  Varint: 0,      // int32, int64, uint32, uint64, sint32, sint64, bool, enum
  Fixed64: 1,     // fixed64, sfixed64, double
  LengthDelimited: 2, // string, bytes, embedded messages, packed repeated fields
  Fixed32: 5,     // fixed32, sfixed32, float
} as const;

// ---------------------------------------------------------------------------
// Helper: create a typed message
// ---------------------------------------------------------------------------

export function createDeviceAnnouncement(
  deviceId: string,
  deviceName: string,
  capabilities: Capabilities
): DeviceAnnouncement {
  return {
    type: 'DEVICE_ANNOUNCEMENT',
    deviceId,
    deviceName,
    capabilities,
  };
}

export function createStartSession(
  sessionId: string,
  video: VideoConfig,
  audio: AudioConfig
): StartSession {
  return {
    type: 'START_SESSION',
    sessionId,
    video,
    audio,
  };
}

export function createControlCommand(
  command: ControlCommand['command'],
  opts?: {
    zoom?: number;
    focus?: boolean;
    torch?: boolean;
    orientation?: ControlCommand['orientation'];
  }
): ControlCommand {
  return {
    type: 'CONTROL_COMMAND',
    command,
    ...opts,
  };
}
