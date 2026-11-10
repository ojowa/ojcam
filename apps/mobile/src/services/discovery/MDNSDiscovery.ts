import { encodeMessageBase64, decodeMessageBase64 } from '../protocol/ProtobufCodec';
import type { DeviceAnnouncement } from '../protocol/messageTypes';
import { deviceIdentity } from '../security/DeviceIdentity';

const MDNS_PORT = 5353;
const MDNS_MULTICAST_ADDR = '224.0.0.251';
export interface DiscoveredDevice {
  deviceId: string; deviceName: string; ipAddress: string; port: number;
  capabilities: { video: boolean; audio: boolean; resolutions: string[]; frameRates: number[] };
  lastSeen: number;
}
export interface MDNSConfig { serviceName: string; port: number; enableAnnounce: boolean; enableBrowse: boolean }
export const defaultMDNSConfig: MDNSConfig = { serviceName: 'Ojowacam Mobile', port: 8080, enableAnnounce: true, enableBrowse: true };
interface UDPSocket {
  send(data: Uint8Array, offset: number, length: number, port: number, host: string, callback?: (error?: Error) => void): void;
  bind(port: number, callback?: () => void): void; addMembership?(address: string): void; close(): void;
  on?(event: string, handler: (...args: any[]) => void): void;
}

export class MDNSDiscovery {
  private config: MDNSConfig; private socket: UDPSocket | null = null; private isRunning = false;
  private devices = new Map<string, DiscoveredDevice>();
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private onDeviceFound?: (device: DiscoveredDevice) => void; private onAnnouncementSent?: () => void;
  constructor(config: MDNSConfig = defaultMDNSConfig) { this.config = { ...config }; }
  setOnDeviceFound(callback: (device: DiscoveredDevice) => void): void { this.onDeviceFound = callback; }
  setOnAnnouncementSent(callback: () => void): void { this.onAnnouncementSent = callback; }
  async start(): Promise<void> {
    if (this.isRunning) return;
    try {
      this.socket = this.createUDPSocket(); this.isRunning = true;
      if (this.config.enableBrowse) this.receiveLoop();
      if (this.config.enableAnnounce) {
        this.sendAnnouncement();
        this.announceTimer = setInterval(() => this.sendAnnouncement(), 30_000);
      }
    } catch (error) {
      this.isRunning = false; this.socket?.close(); this.socket = null;
      console.warn('mDNS discovery unavailable (UDP not supported):', error);
    }
  }
  stop(): void {
    this.isRunning = false;
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    try { this.socket?.close(); } catch { /* already closed */ }
    this.socket = null;
  }
  getDevices(): DiscoveredDevice[] { return [...this.devices.values()]; }
  getDevice(deviceId: string): DiscoveredDevice | undefined { return this.devices.get(deviceId); }
  private createUDPSocket(): UDPSocket {
    const udp = require('react-native-udp');
    if (!udp?.createSocket) throw new Error('react-native-udp is unavailable');
    return udp.createSocket({ type: 'udp4', reuseAddr: true }) as UDPSocket;
  }
  private sendAnnouncement(): void {
    if (!this.socket || !this.isRunning) return;
    try {
      const deviceId = deviceIdentity.getDeviceId();
      const announcement: DeviceAnnouncement = { type: 'DEVICE_ANNOUNCEMENT', deviceId, deviceName: this.config.serviceName,
        capabilities: { video: true, audio: true, resolutions: ['1280x720', '1920x1080', '3840x2160'], frameRates: [30, 60] } };
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'DEVICE_ANNOUNCEMENT', service: this.config.serviceName,
        deviceName: this.config.serviceName, port: this.config.port, data: encodeMessageBase64(announcement), deviceId }));
      this.socket.send(payload, 0, payload.length, MDNS_PORT, MDNS_MULTICAST_ADDR, error => { if (!error) this.onAnnouncementSent?.(); });
    } catch (error) { console.warn('Failed to send mDNS announcement:', error); }
  }
  private receiveLoop(): void {
    const socket = this.socket; if (!socket) return;
    socket.on?.('message', (data: Uint8Array, info: { address: string }) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(data));
        if (message.type !== 'DEVICE_ANNOUNCEMENT' || typeof message.deviceId !== 'string') return;
        const announcement = message.data ? decodeMessageBase64(message.data, 'DEVICE_ANNOUNCEMENT') as DeviceAnnouncement : null;
        const device: DiscoveredDevice = { deviceId: message.deviceId, deviceName: announcement?.deviceName ?? message.deviceName ?? this.config.serviceName,
          ipAddress: info.address, port: message.port ?? MDNS_PORT, capabilities: announcement?.capabilities ?? message.capabilities ?? { video: false, audio: false, resolutions: [], frameRates: [] }, lastSeen: Date.now() };
        this.devices.set(device.deviceId, device); this.onDeviceFound?.(device);
      } catch { /* Ignore malformed multicast packets. */ }
    });
    socket.bind(MDNS_PORT, () => { try { socket.addMembership?.(MDNS_MULTICAST_ADDR); } catch (error) { console.warn('Unable to join mDNS multicast group:', error); } });
  }
}
export const mDNSDiscovery = new MDNSDiscovery();

