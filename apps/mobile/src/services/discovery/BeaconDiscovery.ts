/**
 * BeaconDiscovery.ts
 *
 * Same-network UDP discovery. While the signaling server is running, the
 * phone broadcasts "OJOWACAM|1|role=phone|ws=<port>" to 255.255.255.255:8767
 * every 1.5 s and listens for the OBS plugin's answering beacon
 * ("OJOWACAM|1|role=obs|ws=<port>"). The plugin's WebSocket server is then
 * dialed by SignalingServer (see noteObsTarget). Addresses always come from
 * the datagram's source IP — payload IPs are never trusted.
 */

import { utf8Decode, utf8Encode } from '../../utils/utf8';

export const BEACON_MAGIC = 'OJOWACAM|1';
export const DISCOVERY_PORT = 8767;
const BEACON_INTERVAL_MS = 1500;

export interface ObsTarget {
  ip: string;
  port: number;
}

interface UDPSocketLike {
  send(data: Uint8Array, offset: number, length: number, port: number, host: string, callback?: (error?: Error) => void): void;
  bind(port: number, callback?: () => void): void;
  close(): void;
  on?(event: string, handler: (...args: any[]) => void): void;
}

/**
 * Parses "OJOWACAM|1|role=<role>|ws=<port>" strictly (magic, role, port
 * bounds). Returns the target only for role=obs — the phone never dials
 * itself, and the datagram's source address supplies the IP.
 */
export function parseObsBeacon(data: Uint8Array | string, sourceIp: string): ObsTarget | null {
  const text = typeof data === 'string' ? data : utf8Decode(data);
  if (!text.startsWith(BEACON_MAGIC + '|')) return null;
  if (text.length <= BEACON_MAGIC.length + 1) return null;

  let role = '';
  let wsPort = 0;
  const fields = text.slice(BEACON_MAGIC.length + 1).split('|');
  for (const field of fields) {
    const eq = field.indexOf('=');
    if (eq <= 0) continue;
    const key = field.slice(0, eq);
    const value = field.slice(eq + 1);
    if (key === 'role') role = value;
    else if (key === 'ws') {
      const port = /^\d{1,5}$/.test(value) ? parseInt(value, 10) : 0;
      if (port <= 0 || port > 65535) return null;
      wsPort = port;
    }
  }
  if (role !== 'obs' || wsPort <= 0) return null;
  if (!sourceIp || sourceIp === '0.0.0.0') return null;
  return { ip: sourceIp, port: wsPort };
}

export function buildPhoneBeacon(wsPort: number): Uint8Array {
  return utf8Encode(`${BEACON_MAGIC}|role=phone|ws=${wsPort}`);
}

export class BeaconDiscovery {
  private socket: UDPSocketLike | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onObsDiscovered: ((target: ObsTarget) => void) | null = null;

  setOnObsDiscovered(callback: (target: ObsTarget) => void): void {
    this.onObsDiscovered = callback;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Bind the discovery port, advertise this phone, and watch for the OBS
   * plugin. Returns false when UDP is unavailable — callers treat that as
   * "no discovery", never as success.
   */
  start(wsPort: number): boolean {
    if (this.running) return true;
    if (wsPort <= 0 || wsPort > 65535) return false;

    let socket: UDPSocketLike;
    try {
      const udp = require('react-native-udp');
      if (!udp?.createSocket) throw new Error('react-native-udp is unavailable');
      socket = udp.createSocket({ type: 'udp4', reuseAddr: true }) as UDPSocketLike;
    } catch (error) {
      console.warn('UDP beacon discovery unavailable:', error);
      return false;
    }

    socket.on?.('message', (data: unknown, info: { address?: string }) => {
      if (!this.running) return;
      try {
        const bytes = data instanceof Uint8Array ? data : null;
        if (!bytes) return;
        const target = parseObsBeacon(bytes, info?.address ?? '');
        if (target) this.onObsDiscovered?.(target);
      } catch {
        /* Ignore malformed datagrams. */
      }
    });
    socket.on?.('error', (error: unknown) => {
      console.warn('UDP beacon socket error:', error);
      this.stop();
    });

    socket.bind(DISCOVERY_PORT, () => {
      const beacon = buildPhoneBeacon(wsPort);
      const send = () => {
        if (!this.running || this.socket !== socket) return;
        try {
          socket.send(beacon, 0, beacon.length, DISCOVERY_PORT, '255.255.255.255');
        } catch (error) {
          console.warn('UDP beacon send failed:', error);
        }
      };
      send();
      this.timer = setInterval(send, BEACON_INTERVAL_MS);
    });

    this.socket = socket;
    this.running = true;
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
  }
}

export const beaconDiscovery = new BeaconDiscovery();
