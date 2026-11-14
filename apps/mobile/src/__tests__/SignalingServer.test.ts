/**
 * SignalingServer.test.ts
 * Unit tests for the phone-hosted WebSocket signaling server.
 */

import {
  SignalingServer,
  encodeServerFrame,
  encodeClientFrame,
  encodeClientFrameBytes,
  buildHandshakeRequest,
  verifyHandshakeAccept,
  WsFrameParser,
  buildHandshakeResponse,
  utf8Encode,
  utf8Decode,
  defaultTransportConfig,
} from '../services/signaling/SignalingServer';
import { parseObsBeacon, buildPhoneBeacon } from '../services/discovery/BeaconDiscovery';

jest.mock('react-native-tcp-socket', () => ({
  createServer: jest.fn(),
  createConnection: jest.fn(),
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

  describe('phone dial-out (discovers the plugin server)', () => {
    let dialSocket: FakeSocket | undefined;
    let dialConnect: (() => void) | undefined;

    beforeEach(() => {
      jest.useFakeTimers();
      dialSocket = undefined;
      dialConnect = undefined;
      (TcpSocket.createConnection as unknown as jest.Mock).mockReset();
      (TcpSocket.createConnection as unknown as jest.Mock).mockImplementation(
        (_opts: unknown, cb?: () => void) => {
          dialSocket = new FakeSocket();
          dialConnect = cb;
          return dialSocket;
        },
      );
    });

    afterEach(() => {
      server.disconnect();
      jest.useRealTimers();
    });

    it('waits out the inbound grace period, dials, and accepts the 101', async () => {
      await server.connect();
      server.noteObsTarget({ ip: '10.110.195.204', port: 8766 });

      jest.advanceTimersByTime(2000);
      expect(TcpSocket.createConnection).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1600); // grace period elapsed
      expect(TcpSocket.createConnection).toHaveBeenCalledWith(
        { host: '10.110.195.204', port: 8766 },
        expect.any(Function),
      );
      expect(dialSocket).toBeDefined();

      dialConnect?.(); // TCP session established
      const request = dialSocket!.textWritten(0);
      expect(request).toContain('GET / HTTP/1.1');
      expect(request).toContain('Sec-WebSocket-Key:');
      expect(server.isConnected()).toBe(false);

      const key = /sec-websocket-key:\s*([^\s\r\n]+)/i.exec(request)?.[1] ?? '';
      dialSocket!.emit('data', utf8Encode(buildHandshakeResponse(key)));
      expect(server.isConnected()).toBe(true);
      expect(states.some(s => s.connected)).toBe(true);

      // Connected as the client: outbound frames MUST be masked.
      server.send('{"type":"OFFER"}');
      const frame = dialSocket!.written[dialSocket!.written.length - 1];
      expect(frame[0] & 0x0f).toBe(0x1);
      expect(frame[1] & 0x80).toBe(0x80);
      const parsed = new WsFrameParser().push(frame);
      expect(utf8Decode(parsed[0].payload)).toBe('{"type":"OFFER"}');
    });

    it('drops the dial when an inbound peer wins the race', async () => {
      await server.connect();
      server.noteObsTarget({ ip: '10.110.195.204', port: 8766 });
      jest.advanceTimersByTime(3100); // dial in flight
      expect(dialSocket).toBeDefined();

      // Inbound OBS connection completes before the dial's connect callback.
      const inbound = new FakeSocket();
      connectionHandler?.(inbound);
      inbound.emit('data', utf8Encode(clientHandshake()));
      expect(server.isConnected()).toBe(true);

      dialConnect?.(); // late dial connect must be discarded
      expect(dialSocket!.destroyed).toBe(true);
      expect(inbound.destroyed).toBe(false);
      expect(server.isConnected()).toBe(true);

      inbound.emit('data', maskClientFrame('{"type":"PONG"}'));
      expect(messages).toEqual(['{"type":"PONG"}']);
    });

    it('never dials while an inbound peer is ready', async () => {
      await server.connect();
      server.noteObsTarget({ ip: '10.110.195.204', port: 8766 });
      const inbound = new FakeSocket();
      connectionHandler?.(inbound);
      inbound.emit('data', utf8Encode(clientHandshake()));
      expect(server.isConnected()).toBe(true);

      jest.advanceTimersByTime(10000);
      expect(TcpSocket.createConnection).not.toHaveBeenCalled();
    });

    it('stops advertising and dialing on disconnect', async () => {
      await server.connect();
      server.noteObsTarget({ ip: '10.110.195.204', port: 8766 });
      server.disconnect();
      jest.advanceTimersByTime(10000);
      expect(TcpSocket.createConnection).not.toHaveBeenCalled();
      expect(server.isListening()).toBe(false);
    });
  });
});

describe('client-mode framing (phone dial-out)', () => {
  it('masks client text frames per RFC 6455 §5.3', () => {
    const frame = encodeClientFrame('hello');
    expect(frame[0]).toBe(0x81);
    expect(frame[1] & 0x80).toBe(0x80); // mask bit set
    expect(frame[1] & 0x7f).toBe(5); // length still readable
    const parsed = new WsFrameParser().push(frame);
    expect(utf8Decode(parsed[0].payload)).toBe('hello');
  });

  it('masks 16-bit length binary client frames and round-trips', () => {
    const payload = new Uint8Array(300);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    const frame = encodeClientFrameBytes(payload);
    expect(frame[1] & 0x80).toBe(0x80);
    expect(frame[1] & 0x7f).toBe(126);
    const parsed = new WsFrameParser().push(frame);
    expect(Array.from(parsed[0].payload)).toEqual(Array.from(payload));
  });

  it('keeps server frames unmasked', () => {
    const frame = encodeServerFrame('hello');
    expect(frame[1] & 0x80).toBe(0);
  });
});

describe('client handshake request', () => {
  it('produces a request the server-side handshake accepts', () => {
    const { request, key } = buildHandshakeRequest('10.110.195.204:8766', CLIENT_KEY);
    expect(request.startsWith('GET / HTTP/1.1\r\n')).toBe(true);
    expect(request).toContain('Host: 10.110.195.204:8766\r\n');
    expect(request).toContain(`Sec-WebSocket-Key: ${CLIENT_KEY}\r\n`);
    expect(request.endsWith('\r\n\r\n')).toBe(true);
    expect(verifyHandshakeAccept(buildHandshakeResponse(key), key)).toBe(true);
  });

  it('rejects wrong or missing accept values', () => {
    const { key } = buildHandshakeRequest('x:8766', CLIENT_KEY);
    expect(verifyHandshakeAccept(buildHandshakeResponse(key), 'b3RoZXIga2V5')).toBe(false);
    expect(verifyHandshakeAccept('HTTP/1.1 200 OK\r\n\r\n', key)).toBe(false);
  });
});

describe('parseObsBeacon', () => {
  const src = '10.110.195.204';

  it('accepts the plugin beacon and uses the datagram source IP', () => {
    expect(parseObsBeacon(utf8Encode('OJOWACAM|1|role=obs|ws=8766'), src)).toEqual({
      ip: src,
      port: 8766,
    });
  });

  it('ignores phone beacons, bad ports, and foreign payloads', () => {
    expect(parseObsBeacon(buildPhoneBeacon(8765), src)).toBeNull();
    expect(parseObsBeacon(utf8Encode('OJOWACAM|1|role=obs|ws=99999'), src)).toBeNull();
    expect(parseObsBeacon(utf8Encode('OJOWACAM|1|role=obs|ws=abc'), src)).toBeNull();
    expect(parseObsBeacon(utf8Encode('OJOWACAM|1|role=obs'), src)).toBeNull();
    expect(parseObsBeacon(utf8Encode('HELLO|1|role=obs|ws=8766'), src)).toBeNull();
    expect(parseObsBeacon(utf8Encode('OJOWACAM|1|role=obs|ws=8766'), '0.0.0.0')).toBeNull();
    expect(parseObsBeacon('OJOWACAM|1|role=obs|ws=8766', '')).toBeNull();
  });
});
