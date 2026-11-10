import type { DeviceAnnouncement, StartSession, ControlCommand, Capabilities, VideoConfig, AudioConfig, ProtocolMessage } from './messageTypes';
import { FieldTags, WireType } from './messageTypes';
export { createDeviceAnnouncement, createStartSession, createControlCommand } from './messageTypes';
export type { DeviceAnnouncement, StartSession, ControlCommand, Capabilities, VideoConfig, AudioConfig, ProtocolMessage } from './messageTypes';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Varint must be a non-negative safe integer');
  const bytes: number[] = [];
  while (value >= 0x80) { bytes.push((value % 128) | 0x80); value = Math.floor(value / 128); }
  bytes.push(value);
  return new Uint8Array(bytes);
}
export function decodeVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0; let multiplier = 1; let i = offset;
  while (i < data.length && i - offset < 10) {
    const byte = data[i++]; result += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(result)) throw new Error('Varint exceeds safe integer range');
    if ((byte & 0x80) === 0) return [result, i - offset];
    multiplier *= 128;
  }
  throw new Error('Truncated or oversized varint');
}
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function encodeBytes(value: Uint8Array): Uint8Array { return concat([encodeVarint(value.length), value]); }
function encodeValue(value: number | string | Uint8Array, wire: number): Uint8Array {
  if (wire === WireType.Varint) return encodeVarint(value as number);
  if (wire === WireType.LengthDelimited) return encodeBytes(typeof value === 'string' ? encoder.encode(value) : value as Uint8Array);
  throw new Error(`Unsupported wire type for encoding: ${wire}`);
}
function encodeField(tag: number, wire: number, value: number | string | Uint8Array): Uint8Array {
  return concat([encodeVarint((tag << 3) | wire), encodeValue(value, wire)]);
}
function encodeCapabilities(c: Capabilities): Uint8Array {
  return concat([
    encodeField(FieldTags.Capabilities_video, WireType.Varint, c.video ? 1 : 0),
    encodeField(FieldTags.Capabilities_audio, WireType.Varint, c.audio ? 1 : 0),
    ...c.resolutions.map(v => encodeField(FieldTags.Capabilities_resolutions, WireType.LengthDelimited, v)),
    ...c.frameRates.map(v => encodeField(FieldTags.Capabilities_frameRates, WireType.Varint, v)),
  ]);
}
function encodeVideo(c: VideoConfig): Uint8Array { return concat([
  encodeField(FieldTags.VideoConfig_resolution, WireType.LengthDelimited, c.resolution),
  encodeField(FieldTags.VideoConfig_fps, WireType.Varint, c.fps),
  encodeField(FieldTags.VideoConfig_codec, WireType.LengthDelimited, c.codec),
  encodeField(FieldTags.VideoConfig_bitrate, WireType.Varint, c.bitrate),
]); }
function encodeAudio(c: AudioConfig): Uint8Array { return concat([
  encodeField(FieldTags.AudioConfig_codec, WireType.LengthDelimited, c.codec),
  encodeField(FieldTags.AudioConfig_sampleRate, WireType.Varint, c.sampleRate),
  encodeField(FieldTags.AudioConfig_channels, WireType.Varint, c.channels),
]); }
function encodeAnnouncement(m: DeviceAnnouncement): Uint8Array { return concat([
  encodeField(FieldTags.DeviceAnnouncement_deviceId, WireType.LengthDelimited, m.deviceId),
  encodeField(FieldTags.DeviceAnnouncement_deviceName, WireType.LengthDelimited, m.deviceName),
  encodeField(FieldTags.DeviceAnnouncement_capabilities, WireType.LengthDelimited, encodeCapabilities(m.capabilities)),
]); }
function encodeStart(m: StartSession): Uint8Array { return concat([
  encodeField(FieldTags.StartSession_sessionId, WireType.LengthDelimited, m.sessionId),
  encodeField(FieldTags.StartSession_video, WireType.LengthDelimited, encodeVideo(m.video)),
  encodeField(FieldTags.StartSession_audio, WireType.LengthDelimited, encodeAudio(m.audio)),
]); }
function encodeControl(m: ControlCommand): Uint8Array {
  const parts = [encodeField(FieldTags.ControlCommand_type, WireType.LengthDelimited, m.command)];
  if (m.zoom !== undefined) parts.push(encodeField(FieldTags.ControlCommand_zoom, WireType.Varint, m.zoom));
  if (m.focus !== undefined) parts.push(encodeField(FieldTags.ControlCommand_focus, WireType.Varint, m.focus ? 1 : 0));
  if (m.torch !== undefined) parts.push(encodeField(FieldTags.ControlCommand_torch, WireType.Varint, m.torch ? 1 : 0));
  if (m.orientation !== undefined) parts.push(encodeField(FieldTags.ControlCommand_orientation, WireType.LengthDelimited, m.orientation));
  return concat(parts);
}
export function encodeMessage(message: ProtocolMessage): Uint8Array {
  switch (message.type) {
    case 'DEVICE_ANNOUNCEMENT': return encodeAnnouncement(message);
    case 'START_SESSION': return encodeStart(message);
    case 'CONTROL_COMMAND': return encodeControl(message);
  }
}
export function encodeMessageBase64(message: ProtocolMessage): string {
  let binary = ''; for (const b of encodeMessage(message)) binary += String.fromCharCode(b);
  return btoa(binary);
}

type Field = { tag: number; wire: number; value: number | Uint8Array };
function readField(data: Uint8Array, offset: number): [Field, number] {
  const [key, keySize] = decodeVarint(data, offset); const tag = Math.floor(key / 8); const wire = key & 7;
  if (tag === 0) throw new Error('Invalid protobuf field number');
  let cursor = offset + keySize;
  if (wire === WireType.Varint) { const [value, size] = decodeVarint(data, cursor); return [{ tag, wire, value }, keySize + size]; }
  if (wire === WireType.LengthDelimited) {
    const [length, size] = decodeVarint(data, cursor); cursor += size;
    if (length > data.length - cursor) throw new Error('Truncated length-delimited field');
    return [{ tag, wire, value: data.slice(cursor, cursor + length) }, size + keySize + length];
  }
  let skip = wire === 1 ? 8 : wire === 5 ? 4 : 0;
  if (!skip) throw new Error(`Unsupported wire type for decoding: ${wire}`);
  if (cursor + skip > data.length) throw new Error('Truncated fixed-width field');
  return [{ tag, wire, value: data.slice(cursor, cursor + skip) }, keySize + skip];
}
function fields(data: Uint8Array): Field[] {
  const out: Field[] = []; let offset = 0;
  while (offset < data.length) { const [field, count] = readField(data, offset); if (count <= 0) throw new Error('Invalid protobuf field'); out.push(field); offset += count; }
  return out;
}
function str(f: Field): string { if (!(f.value instanceof Uint8Array)) throw new Error('Expected length-delimited string'); return decoder.decode(f.value); }
function num(f: Field): number { if (typeof f.value !== 'number') throw new Error('Expected varint'); return f.value; }
function nested(f: Field): Field[] { if (!(f.value instanceof Uint8Array)) throw new Error('Expected nested message'); return fields(f.value); }
function last(fs: Field[], tag: number): Field | undefined { return [...fs].reverse().find(f => f.tag === tag); }
function decodeCapabilities(fs: Field[]): Capabilities {
  return { video: num(last(fs, FieldTags.Capabilities_video) ?? { tag: 1, wire: 0, value: 0 }) !== 0,
    audio: num(last(fs, FieldTags.Capabilities_audio) ?? { tag: 2, wire: 0, value: 0 }) !== 0,
    resolutions: fs.filter(f => f.tag === FieldTags.Capabilities_resolutions).map(str),
    frameRates: fs.filter(f => f.tag === FieldTags.Capabilities_frameRates).map(num) };
}
function decodeVideo(fs: Field[]): VideoConfig { return {
  resolution: last(fs, FieldTags.VideoConfig_resolution) ? str(last(fs, FieldTags.VideoConfig_resolution)!) : '',
  fps: last(fs, FieldTags.VideoConfig_fps) ? num(last(fs, FieldTags.VideoConfig_fps)!) : 30,
  codec: last(fs, FieldTags.VideoConfig_codec) ? str(last(fs, FieldTags.VideoConfig_codec)!) : 'H264',
  bitrate: last(fs, FieldTags.VideoConfig_bitrate) ? num(last(fs, FieldTags.VideoConfig_bitrate)!) : 0,
}; }
function decodeAudio(fs: Field[]): AudioConfig { return {
  codec: last(fs, FieldTags.AudioConfig_codec) ? str(last(fs, FieldTags.AudioConfig_codec)!) : 'OPUS',
  sampleRate: last(fs, FieldTags.AudioConfig_sampleRate) ? num(last(fs, FieldTags.AudioConfig_sampleRate)!) : 48000,
  channels: last(fs, FieldTags.AudioConfig_channels) ? num(last(fs, FieldTags.AudioConfig_channels)!) : 2,
}; }
export function decodeMessage(data: Uint8Array, expectedType?: string): ProtocolMessage {
  if (!expectedType && data.length > 0) expectedType = 'DEVICE_ANNOUNCEMENT';
  const fs = fields(data);
  if (expectedType === 'DEVICE_ANNOUNCEMENT') {
    const caps = last(fs, FieldTags.DeviceAnnouncement_capabilities);
    return { type: expectedType, deviceId: last(fs, FieldTags.DeviceAnnouncement_deviceId) ? str(last(fs, FieldTags.DeviceAnnouncement_deviceId)!) : '', deviceName: last(fs, FieldTags.DeviceAnnouncement_deviceName) ? str(last(fs, FieldTags.DeviceAnnouncement_deviceName)!) : '', capabilities: caps ? decodeCapabilities(nested(caps)) : { video: false, audio: false, resolutions: [], frameRates: [] } };
  }
  if (expectedType === 'START_SESSION') {
    const video = last(fs, FieldTags.StartSession_video); const audio = last(fs, FieldTags.StartSession_audio);
    return { type: expectedType, sessionId: last(fs, FieldTags.StartSession_sessionId) ? str(last(fs, FieldTags.StartSession_sessionId)!) : '', video: video ? decodeVideo(nested(video)) : { resolution: '', fps: 30, codec: 'H264', bitrate: 0 }, audio: audio ? decodeAudio(nested(audio)) : { codec: 'OPUS', sampleRate: 48000, channels: 2 } };
  }
  if (expectedType === 'CONTROL_COMMAND') {
    const get = (tag: number) => last(fs, tag);
    const command = get(FieldTags.ControlCommand_type);
    const zoom = get(FieldTags.ControlCommand_zoom); const focus = get(FieldTags.ControlCommand_focus); const torch = get(FieldTags.ControlCommand_torch); const orientation = get(FieldTags.ControlCommand_orientation);
    return { type: expectedType, command: command ? str(command) as ControlCommand['command'] : 'orientation', ...(zoom ? { zoom: num(zoom) } : {}), ...(focus ? { focus: num(focus) !== 0 } : {}), ...(torch ? { torch: num(torch) !== 0 } : {}), ...(orientation ? { orientation: str(orientation) as ControlCommand['orientation'] } : {}) };
  }
  throw new Error(`Unknown or unsupported message type: ${expectedType}`);
}
export function decodeMessageBase64(base64: string, expectedType?: string): ProtocolMessage {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/'); const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4); const binary = atob(padded); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeMessage(bytes, expectedType);
}
