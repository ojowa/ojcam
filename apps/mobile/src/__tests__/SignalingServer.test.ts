/**
 * SignalingServer.test.ts
 * Unit tests for the phone-hosted WebSocket signaling server.
 */

import {
  SignalingServer,
  encodeServerFrame,
  WsFrameParser,
  buildHandshakeResponse,
  utf8Encode,
  utf8Decode,
  defaultTransportConfig,
} from '../services/signaling/SignalingServer';

jest.mock('react-native-tcp-socket', () => ({
  createServer: jest.fn(),
}));

import TcpSocket from 'react-native-tcp-socket';

class FakeSocket {
  written: Uint8Array[] = [];
  destroyed = false;
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};
  on(event: string, handler: (...args: any[]) => void): void {
    (this.handlers[event] = this.handlers[event] || []).push(handler);
  }
  emit(event: string, ...args: any[]): void {
    for (const handler of this.handlers[event] || []) handler(...args);
  }
  write(data: Uint8Array): boolean {
    if (this.destroyed) throw new Error('Socket is closed');
    this.written.push(data);
    return true;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
  textWritten(index: number): string {
    return utf8Decode(this.written[index]);
  }
}

function maskClientFrame(text: string, opcode = 0x1): Uint8Array {
  const payload = utf8Encode(text);
  const mask = [0x1a, 0x2b, 0x3c, 0x4d];
  const header: number[] = [0x80 | opcode];
  if (payload.length <= 125) {
    header.push(0x80 | payload.length);
  } else if (payload.length <= 0xffff) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(0x80 | 127, 0, 0, 0, 0, (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff);
  }
  const out = new Uint8Array(header.length + 4 + payload.length);
  out.set(header, 0);
  out.set(mask, header.length);
  for (let i = 0; i < payload.length; i++) {
    out[header.length + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return out;
}

const CLIENT_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const CLIENT_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

function clientHandshake(): string {
  return (
    'GET / HTTP/1.1\r\n' +
    'Host: 192.168.1.50:8765\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Key: ${CLIENT_KEY}\r\n` +
    'Sec-WebSocket-Version: 13\r\n\r\n'
  );
}

describe('RFC 6455 framing', () => {
  it('encodes an unmasked server text frame', () => {
    const frame = encodeServerFrame('hello');
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(5);
    expect(utf8Decode(frame.subarray(2))).toBe('hello');
  });

  it('encodes 16-bit length frames', () => {
    const payload = 'x'.repeat(300);
    const frame = encodeServerFrame(payload);
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(126);
    expect(((frame[2] << 8) | frame[3])).toBe(300);
    expect(utf8Decode(frame.subarray(4))).toBe(payload);
  });

  it('decodes a masked client frame', () => {
    const parser = new WsFrameParser();
    const frames = parser.push(maskClientFrame('{"type":"PONG"}'));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0x1);
    expect(frames[0].fin).toBe(true);
    expect(utf8Decode(frames[0].payload)).toBe('{"type":"PONG"}');
  });

  it('handles frames split across chunks', () => {
    const parser = new WsFrameParser();
    const bytes = maskClientFrame('{"type":"OFFER","sdp":"v=0"}');
    expect(parser.push(bytes.subarray(0, 3))).toHaveLength(0);
    const frames = parser.push(bytes.subarray(3));
    expect(frames).toHaveLength(1);
    expect(utf8Decode(frames[0].payload)).toBe('{"type":"OFFER","sdp":"v=0"}');
  });

  it('decodes close frames', () => {
    const parser = new WsFrameParser();
    const frames = parser.push(maskClientFrame('', 0x8));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0x8);
  });

  it('round-trips multi-byte UTF-8 payloads', () => {
    const text = 'käse 🎥 done';
    const parser = new WsFrameParser();
    const frames = parser.push(maskClientFrame(text));
    expect(utf8Decode(frames[0].payload)).toBe(text);
  });
});

describe('buildHandshakeResponse', () => {
  it('matches the RFC 6455 example', () => {
    const response = buildHandshakeResponse(CLIENT_KEY);
    expect(response).toContain('HTTP/1.1 101 Switching Protocols');
    expect(response).toContain(`Sec-WebSocket-Accept: ${CLIENT_ACCEPT}`);
    expect(response.endsWith('\r\n\r\n')).toBe(true);
  });
});

describe('SignalingServer', () => {
  let fakeServer: {
    listen: jest.Mock;
    close: jest.Mock;
    on: jest.Mock;
    handlers: Record<string, (...args: any[]) => void>;
  };
  let connectionHandler: ((socket: FakeSocket) => void) | undefined;
  let server: SignalingServer;
  let messages: string[];
  let states: Array<{ connected: boolean; queuedMessages: number }>;

  beforeEach(() => {
    messages = [];
    states = [];
    connectionHandler = undefined;
    fakeServer = {
      listen: jest.fn((_opts: unknown, cb?: () => void) => {
        cb?.();
        fakeServer.handlers['listening']?.();
      }),
      close: jest.fn(),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        fakeServer.handlers[event] = handler;
      }),
      handlers: {},
    };
    (TcpSocket.createServer as unknown as jest.Mock).mockImplementation((handler: (socket: FakeSocket) => void) => {
      connectionHandler = handler;
      return fakeServer;
    });
    server = new SignalingServer({ ...defaultTransportConfig });
    server.setOnMessage(data => messages.push(data));
    server.setOnStateChange(state => states.push({ connected: state.connected, queuedMessages: state.queuedMessages }));
  });

  afterEach(() => {
    server.disconnect();
  });

  it('binds the configured port on connect', async () => {
    await server.connect();
    expect(fakeServer.listen).toHaveBeenCalledWith(expect.objectContaining({ port: 8765, host: '0.0.0.0' }));
    expect(server.isConnected()).toBe(false);
  });

  it('completes the WebSocket handshake and reports connected', async () => {
    await server.connect();
    const socket = new FakeSocket();
    connectionHandler?.(socket);
    expect(server.isConnected()).toBe(false);

    socket.emit('data', utf8Encode(clientHandshake()));
    expect(socket.written).toHaveLength(1);
    expect(socket.textWritten(0)).toContain('101 Switching Protocols');
    expect(socket.textWritten(0)).toContain(CLIENT_ACCEPT);
    expect(server.isConnected()).toBe(true);
    expect(states.some(s => s.connected)).toBe(true);
  });

  it('delivers masked client frames to the message handler', async () => {
    await server.connect();
    const socket = new FakeSocket();
    connectionHandler?.(socket);
    socket.emit('data', utf8Encode(clientHandshake()));

    socket.emit('data', maskClientFrame('{"type":"PONG"}'));
    socket.emit('data', maskClientFrame('{"type":"OFFER","sdp":"v=0"}'));
    expect(messages).toEqual(['{"type":"PONG"}', '{"type":"OFFER","sdp":"v=0"}']);
  });

  it('sends unmasked server frames and flushes the queue after handshake', async () => {
    await server.connect();
    server.send('{"type":"OFFER"}');
    expect(server.getState().queuedMessages).toBe(1);

    const socket = new FakeSocket();
    connectionHandler?.(socket);
    expect(server.getState().queuedMessages).toBe(1); // waiting for handshake
    socket.emit('data', utf8Encode(clientHandshake()));

    expect(server.getState().queuedMessages).toBe(0);
    expect(messages).toHaveLength(0);
    expect(socket.written).toHaveLength(2); // 101 response + queued frame

    const frame = socket.written[1];
    expect(frame[0]).toBe(0x81);
    expect((frame[1] & 0x80)).toBe(0); // server frames are unmasked
    expect(utf8Decode(frame.subarray(2))).toBe('{"type":"OFFER"}');
  });

  it('responds to ping frames with a pong', async () => {
    await server.connect();
    const socket = new FakeSocket();
    connectionHandler?.(socket);
    socket.emit('data', utf8Encode(clientHandshake()));

    socket.emit('data', maskClientFrame('ping-bytes', 0x9));
    const pongFrame = socket.written[socket.written.length - 1];
    expect(pongFrame[0] & 0x0f).toBe(0xa);
    expect(utf8Decode(pongFrame.subarray(2))).toBe('ping-bytes');
  });

  it('drops the peer when a close frame arrives', async () => {
    await server.connect();
    const socket = new FakeSocket();
    connectionHandler?.(socket);
    socket.emit('data', utf8Encode(clientHandshake()));
    expect(server.isConnected()).toBe(true);

    socket.emit('data', maskClientFrame('', 0x8));
    expect(server.isConnected()).toBe(false);
    expect(socket.destroyed).toBe(true);
  });

  it('rejects handshakes without a WebSocket key', async () => {
    await server.connect();
    const socket = new FakeSocket();
    connectionHandler?.(socket);
    socket.emit('data', utf8Encode('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
    expect(socket.textWritten(0)).toContain('400 Bad Request');
    expect(server.isConnected()).toBe(false);
  });

  it('replaces an existing peer when a new OBS connects', async () => {
    await server.connect();
    const first = new FakeSocket();
    connectionHandler?.(first);
    first.emit('data', utf8Encode(clientHandshake()));
    expect(server.isConnected()).toBe(true);

    const second = new FakeSocket();
    connectionHandler?.(second);
    expect(first.destroyed).toBe(true);
    expect(server.isConnected()).toBe(false);

    second.emit('data', utf8Encode(clientHandshake()));
    expect(server.isConnected()).toBe(true);
    second.emit('data', maskClientFrame('{"type":"PONG"}'));
    expect(messages).toEqual(['{"type":"PONG"}']);
  });

  it('parses the port from the configured URL', async () => {
    server = new SignalingServer({ ...defaultTransportConfig, url: 'ws://0.0.0.0:9999' });
    await server.connect();
    expect(fakeServer.listen).toHaveBeenCalledWith(expect.objectContaining({ port: 9999 }));
    server.disconnect();
  });
});
