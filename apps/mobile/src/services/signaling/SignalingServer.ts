/**
 * SignalingServer.ts
 *
 * Phone-hosted WebSocket (RFC 6455) signaling server. The phone listens on
 * the LAN; the OBS plugin dials in with its existing SignalingClient.
 *
 * Exposes the same surface as the old outbound WebSocketTransport
 * (connect/send/getState/setOnMessage/...) so SignalingService only swaps
 * its transport implementation.
 */

import { sha1 } from 'js-sha1';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_PORT = 8765;
const MAX_HANDSHAKE_BYTES = 16 * 1024;

export interface TransportConfig {
  url: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  messageQueueMaxSize: number;
}
export interface TransportState {
  connected: boolean;
  reconnecting: boolean;
  attemptCount: number;
  queuedMessages: number;
}
export type TransportMessageHandler = (data: string) => void;
export type TransportStateHandler = (state: TransportState) => void;
export type TransportErrorHandler = (error: Error) => void;

export const defaultTransportConfig: TransportConfig = {
  url: 'ws://0.0.0.0:8765',
  heartbeatIntervalMs: 15000,
  heartbeatTimeoutMs: 5000,
  messageQueueMaxSize: 100,
};

// ---------------------------------------------------------------------------
// Byte helpers (Hermes has no TextEncoder/TextDecoder)
// ---------------------------------------------------------------------------

export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if ((b0 & 0xe0) === 0xc0) cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if ((b0 & 0xf0) === 0xe0) {
      cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else if ((b0 & 0xf8) === 0xf0) {
      cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    } else {
      continue;
    }
    if (cp > 0xffff) {
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
  }
  return out;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sha1Base64(message: string): string {
  const digest = sha1.array(message);
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// RFC 6455 framing (pure, unit-testable)
// ---------------------------------------------------------------------------

export interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}

/** Server→client frame. Servers must NOT mask. */
export function encodeServerFrame(payload: string, opcode = 0x1): Uint8Array {
  const data = utf8Encode(payload);
  const len = data.length;
  let header: number[];
  if (len <= 125) {
    header = [0x80 | opcode, len];
  } else if (len <= 0xffff) {
    header = [0x80 | opcode, 126, (len >> 8) & 0xff, len & 0xff];
  } else {
    header = [0x80 | opcode, 127, 0, 0, 0, 0, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  }
  const out = new Uint8Array(header.length + len);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
}

/**
 * Incremental client→server frame parser. Clients (the OBS plugin) mask
 * their frames, so payloads are unmasked here. Handles fragmentation at the
 * frame level (continuation frames are returned as opcode 0x0).
 */
export class WsFrameParser {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): WsFrame[] {
    this.buffer = concatBytes(this.buffer, chunk);
    const frames: WsFrame[] = [];
    for (;;) {
      const frame = this.tryReadFrame();
      if (!frame) break;
      frames.push(frame);
    }
    return frames;
  }

  private tryReadFrame(): WsFrame | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = (buf[2] << 8) | buf[3];
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      // Signalling payloads are far below 2^53; reject absurd lengths.
      const hi = ((buf[2] << 24) >>> 0) + (buf[3] << 16) + (buf[4] << 8) + buf[5];
      if (hi !== 0) return null;
      len = ((buf[6] << 24) >>> 0) + (buf[7] << 16) + (buf[8] << 8) + buf[9];
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return null;

    const payload = new Uint8Array(len);
    if (masked) {
      const mask = buf.subarray(offset, offset + 4);
      for (let i = 0; i < len; i++) {
        payload[i] = buf[offset + 4 + i] ^ mask[i % 4];
      }
    } else {
      payload.set(buf.subarray(offset, offset + len));
    }
    this.buffer = buf.slice(offset + maskLen + len);
    return { fin, opcode, payload };
  }
}

/** Compute the `Sec-WebSocket-Accept` value for a client key. */
export function buildHandshakeResponse(clientKey: string): string {
  const accept = sha1Base64(clientKey.trim() + WS_GUID);
  return (
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );
}

function portFromUrl(url: string): number {
  const match = /:(\d+)/.exec(url || '');
  const port = match ? parseInt(match[1], 10) : DEFAULT_PORT;
  return port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

// ---------------------------------------------------------------------------
// Minimal TCP socket/server shapes (react-native-tcp-socket)
// ---------------------------------------------------------------------------

interface TcpSocketLike {
  on(event: string, handler: (...args: any[]) => void): void;
  write(data: Uint8Array): boolean;
  destroy(): void;
  destroyed?: boolean;
}
interface TcpServerLike {
  listen(options: { port: number; host?: string; reuseAddress?: boolean }, callback?: () => void): void;
  close(callback?: (err?: Error) => void): void;
  on(event: string, handler: (...args: any[]) => void): void;
}
interface TcpSocketModule {
  createServer(onConnection: (socket: TcpSocketLike) => void): TcpServerLike;
}

export class SignalingServer {
  private config: TransportConfig;
  private server: TcpServerLike | null = null;
  private peer: TcpSocketLike | null = null;
  private parser = new WsFrameParser();
  private handshakeBuf: Uint8Array = new Uint8Array(0);
  private handshaken = false;
  private listening = false;
  private port = DEFAULT_PORT;
  private state: TransportState = {
    connected: false,
    reconnecting: false,
    attemptCount: 0,
    queuedMessages: 0,
  };
  private handlers: {
    onMessage?: TransportMessageHandler;
    onStateChange?: TransportStateHandler;
    onError?: TransportErrorHandler;
  } = {};
  private messageQueue: string[] = [];
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastPongTime = 0;

  constructor(config: TransportConfig = defaultTransportConfig) {
    this.config = { ...config };
    this.port = portFromUrl(config.url);
  }

  setUrl(url: string): void {
    this.config.url = url;
    if (!this.listening) this.port = portFromUrl(url);
  }
  setOnMessage(handler: TransportMessageHandler): void {
    this.handlers.onMessage = handler;
  }
  setOnStateChange(handler: TransportStateHandler): void {
    this.handlers.onStateChange = handler;
  }
  setOnError(handler: TransportErrorHandler): void {
    this.handlers.onError = handler;
  }
  getState(): TransportState {
    return { ...this.state };
  }
  isConnected(): boolean {
    return this.state.connected;
  }
  isListening(): boolean {
    return this.listening;
  }

  /** Start listening for the OBS plugin. Resolves once the port is bound. */
  async connect(): Promise<void> {
    if (this.listening) return;
    const TcpSocket = require('react-native-tcp-socket') as TcpSocketModule;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      try {
        const server = TcpSocket.createServer(socket => this.onConnection(socket));
        this.server = server;
        server.on('listening', () => {
          this.listening = true;
          if (!settled) {
            settled = true;
            resolve();
          }
        });
        server.on('error', (err: Error) => {
          if (!settled) {
            settled = true;
            this.server = null;
            this.listening = false;
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          this.handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
        });
        server.listen({ port: this.port, host: '0.0.0.0', reuseAddress: true });
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    const peer = this.peer;
    this.peer = null;
    this.handshaken = false;
    try {
      peer?.destroy();
    } catch {
      /* already closed */
    }
    const server = this.server;
    this.server = null;
    this.listening = false;
    try {
      server?.close();
    } catch {
      /* already closed */
    }
    this.state.connected = false;
    this.state.reconnecting = false;
    this.state.attemptCount = 0;
    this.notifyStateChange();
  }

  send(data: string): boolean {
    if (!this.isReady() || !this.peer) {
      this.enqueue(data);
      return false;
    }
    try {
      this.peer.write(encodeServerFrame(data));
      return true;
    } catch {
      this.enqueue(data);
      return false;
    }
  }

  async sendReliable(data: string): Promise<boolean> {
    if (this.isReady()) return this.send(data);
    return new Promise(resolve => {
      let done = false;
      const finish = (sent: boolean) => {
        if (done) return;
        done = true;
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(sent);
      };
      const interval = setInterval(() => {
        if (this.isReady()) finish(this.send(data));
      }, 100);
      const timeout = setTimeout(() => finish(false), 10_000);
    });
  }

  private isReady(): boolean {
    return this.state.connected && this.handshaken && this.peer !== null;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  private onConnection(socket: TcpSocketLike): void {
    // Single active receiver: a new OBS connection replaces the previous one.
    const previous = this.peer;
    this.peer = null;
    if (previous) {
      const wasConnected = this.state.connected;
      this.stopHeartbeat();
      this.state.connected = false;
      this.handshaken = false;
      try {
        previous.destroy();
      } catch {
        /* already closed */
      }
      if (wasConnected) this.notifyStateChange();
    }

    this.peer = socket;
    this.parser = new WsFrameParser();
    this.handshakeBuf = new Uint8Array(0);
    this.handshaken = false;

    socket.on('data', (data: unknown) => this.onData(socket, data));
    socket.on('close', () => this.onPeerClosed(socket));
    socket.on('error', (err: unknown) => {
      if (this.peer !== socket) return;
      this.handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }

  private onData(socket: TcpSocketLike, data: unknown): void {
    if (this.peer !== socket) return;
    const bytes = toBytes(data);
    if (!bytes) return;

    if (!this.handshaken) {
      this.handshakeBuf = concatBytes(this.handshakeBuf, bytes);
      if (this.handshakeBuf.length > MAX_HANDSHAKE_BYTES) {
        this.dropPeer(socket);
        return;
      }
      const headerEnd = indexOfHeaderEnd(this.handshakeBuf);
      if (headerEnd < 0) return;

      const headerText = bytesToLatin1(this.handshakeBuf.subarray(0, headerEnd));
      const keyMatch = /sec-websocket-key:\s*([^\s]+)/i.exec(headerText);
      if (!keyMatch) {
        try {
          socket.write(utf8Encode('HTTP/1.1 400 Bad Request\r\n\r\n'));
        } catch {
          /* best effort */
        }
        this.dropPeer(socket);
        return;
      }
      try {
        socket.write(utf8Encode(buildHandshakeResponse(keyMatch[1])));
      } catch (error) {
        this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.dropPeer(socket);
        return;
      }

      const remainder = this.handshakeBuf.slice(headerEnd + 4);
      this.handshakeBuf = new Uint8Array(0);
      this.handshaken = true;
      this.markConnected();
      if (remainder.length > 0) this.dispatchFrames(socket, remainder);
      return;
    }

    this.dispatchFrames(socket, bytes);
  }

  private dispatchFrames(socket: TcpSocketLike, bytes: Uint8Array): void {
    let frames: WsFrame[];
    try {
      frames = this.parser.push(bytes);
    } catch (error) {
      this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.dropPeer(socket);
      return;
    }
    for (const frame of frames) {
      if (this.peer !== socket) return;
      switch (frame.opcode) {
        case 0x8: // close
          try {
            socket.write(encodeServerFrame('', 0x8));
          } catch {
            /* best effort */
          }
          this.dropPeer(socket);
          return;
        case 0x9: // ping → pong
          try {
            socket.write(encodeServerFrame(utf8Decode(frame.payload), 0xa));
          } catch {
            /* best effort */
          }
          break;
        case 0xa: // pong (protocol level; liveness uses app-level PONG)
          break;
        case 0x1:
        case 0x2:
        case 0x0: {
          const text = utf8Decode(frame.payload);
          this.notePong(text);
          this.handlers.onMessage?.(text);
          break;
        }
        default:
          break;
      }
    }
  }

  private notePong(text: string): void {
    try {
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed && parsed.type === 'PONG') this.lastPongTime = Date.now();
    } catch {
      /* non-JSON frames are handed to the app as-is */
    }
  }

  private markConnected(): void {
    this.state.connected = true;
    this.state.reconnecting = false;
    this.state.attemptCount = 0;
    this.lastPongTime = Date.now();
    this.startHeartbeat();
    this.flushQueue();
    this.notifyStateChange();
  }

  private onPeerClosed(socket: TcpSocketLike): void {
    if (this.peer !== socket) return;
    this.peer = null;
    this.handshaken = false;
    this.stopHeartbeat();
    this.state.connected = false;
    this.notifyStateChange();
  }

  private dropPeer(socket: TcpSocketLike): void {
    if (this.peer !== socket) return;
    this.peer = null;
    this.handshaken = false;
    this.stopHeartbeat();
    try {
      socket.destroy();
    } catch {
      /* already closed */
    }
    this.state.connected = false;
    this.notifyStateChange();
  }

  // -------------------------------------------------------------------------
  // Heartbeat: phone pings, OBS must reply PONG within interval+timeout
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();
    this.heartbeatIntervalId = setInterval(() => {
      if (!this.isReady() || !this.peer) return;
      if (Date.now() - this.lastPongTime > this.config.heartbeatIntervalMs + this.config.heartbeatTimeoutMs) {
        this.dropPeer(this.peer);
        return;
      }
      try {
        this.peer.write(encodeServerFrame(JSON.stringify({ type: 'PING' })));
      } catch {
        this.dropPeer(this.peer);
        return;
      }
      if (this.heartbeatTimeoutId) clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = setTimeout(() => {
        if (!this.isReady() || !this.peer) return;
        if (Date.now() - this.lastPongTime > this.config.heartbeatIntervalMs + this.config.heartbeatTimeoutMs) {
          this.dropPeer(this.peer);
        }
      }, this.config.heartbeatTimeoutMs);
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
    if (this.heartbeatTimeoutId) clearTimeout(this.heartbeatTimeoutId);
    this.heartbeatIntervalId = null;
    this.heartbeatTimeoutId = null;
  }

  private enqueue(data: string): void {
    if (this.messageQueue.length >= this.config.messageQueueMaxSize) this.messageQueue.shift();
    this.messageQueue.push(data);
    this.state.queuedMessages = this.messageQueue.length;
    this.notifyStateChange();
  }

  private flushQueue(): void {
    if (!this.isReady() || !this.peer) return;
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue[0];
      try {
        this.peer.write(encodeServerFrame(message));
        this.messageQueue.shift();
      } catch {
        break;
      }
    }
    this.state.queuedMessages = this.messageQueue.length;
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    this.handlers.onStateChange?.({ ...this.state });
  }
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data === 'string') {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
    return out;
  }
  return null;
}

function indexOfHeaderEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}
