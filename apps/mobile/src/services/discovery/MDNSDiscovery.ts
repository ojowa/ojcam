/**
 * MDNSDiscovery.ts
 * 
 * mDNS / DNS-SD service discovery for Ojowacam.
 * 
 * Broadcasts a DeviceAnnouncement via mDNS so the desktop receiver can
 * discover the mobile device on the local network.
 */

import {
  encodeMessageBase64,
  decodeMessageBase64,
  type DeviceAnnouncement,
} from '../protocol/ProtobufCodec';
import { deviceIdentity } from '../security/DeviceIdentity';

const MDNS_PORT = 5353;
const MDNS_MULTICAST_ADDR = '224.0.0.251';

export interface DiscoveredDevice {
  deviceId: string;
  deviceName: string;
  ipAddress: string;
  port: number;
  capabilities: {
    video: boolean;
    audio: boolean;
    resolutions: string[];
    frameRates: number[];
  };
  lastSeen: number;
}

export interface MDNSConfig {
  serviceName: string;
  port: number;
  enableAnnounce: boolean;
  enableBrowse: boolean;
}

export const defaultMDNSConfig: MDNSConfig = {
  serviceName: 'Ojowacam Mobile',
  port: 8080,
  enableAnnounce: true,
  enableBrowse: true,
};

export class MDNSDiscovery {
  private config: MDNSConfig;
  private socket: UDPSocket | null = null;
  private isRunning = false;
  private devices: Map<string, DiscoveredDevice> = new Map();

  private onDeviceFound?: (device: DiscoveredDevice) => void;
  private onAnnouncementSent?: () => void;

  constructor(config: MDNSConfig = defaultMDNSConfig) {
    this.config = config;
  }

  setOnDeviceFound(callback: (device: DiscoveredDevice) => void): void {
    this.onDeviceFound = callback;
  }

  setOnAnnouncementSent(callback: () => void): void {
    this.onAnnouncementSent = callback;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;

  private createUDPSocket(): UDPSocket {
    let socket: UDPSocket | null = null;

    const candidates = [
      (globalThis as any).UDP,
      (globalThis as any).DatagramSocket,
      (globalThis as any).UDPSocket,
    ];

    for (const Ctor of candidates) {
      if (Ctor) {
        try {
          socket = new Ctor();
          break;
        } catch {
          // try next
        }
      }
    }

    if (!socket) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const udp = require('react-native-udp');
        if (udp && udp.createSocket) {
          socket = udp.createSocket({ type: 'udp4', reuseAddr: true });
        }
      } catch {
        // ignore
      }
    }

    if (!socket) {
      throw new Error('No UDP socket implementation available');
    }

    return socket;
  }

  private sendAnnouncement(): void {
    if (!this.socket || !this.isRunning) {
      return;
    }

    try {
      const deviceId = deviceIdentity.getDeviceId();
      const announcement: DeviceAnnouncement = {
        type: 'DEVICE_ANNOUNCEMENT',
        deviceId,
        deviceName: this.config.serviceName,
        capabilities: {
          video: true,
          audio: true,
          resolutions: ['1280x720', '1920x1080', '3840x2160'],
          frameRates: [30, 60],
        },
      };

      const encoded = encodeMessageBase64(announcement);

      const payload = JSON.stringify({
        type: 'DEVICE_ANNOUNCEMENT',
        service: this.config.serviceName,
        port: this.config.port,
        data: encoded,
        deviceId,
      });

      const bytes = new TextEncoder().encode(payload);

      this.socket.send(bytes, MDNS_PORT, MDNS_MULTICAST_ADDR);
      this.onAnnouncementSent?.call(this);
    } catch (err) {
      console.warn('Failed to send mDNS announcement:', err);
    }
  }

  private receiveLoop(): void {
    if (!this.socket) {
      return;
    }

    const onMessage = (data: Uint8Array, rinfo: { address: string; port: number }) => {
      try {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text);

        if (msg.type === 'DEVICE_ANNOUNCEMENT' && msg.deviceId) {
          let capabilities: DiscoveredDevice['capabilities'] = {
            video: false,
            audio: false,
            resolutions: [],
            frameRates: [],
          };

          if (msg.data) {
            try {
              const announcement = decodeMessageBase64(msg.data, 'DEVICE_ANNOUNCEMENT');
              capabilities = {
                video: announcement.capabilities.video,
                audio: announcement.capabilities.audio,
                resolutions: announcement.capabilities.resolutions,
                frameRates: announcement.capabilities.frameRates,
              };
            } catch {
              capabilities = msg.capabilities || capabilities;
            }
          }

          const device: DiscoveredDevice = {
            deviceId: msg.deviceId,
            deviceName: msg.deviceName || this.config.serviceName,
            ipAddress: rinfo.address,
            port: msg.port ?? MDNS_PORT,
            capabilities,
            lastSeen: Date.now(),
          };

          this.devices.set(device.deviceId, device);
          this.onDeviceFound?.call(this, device);
        }
      } catch {
        // Ignore malformed mDNS packets
      }
    };

    try {
      this.socket.bind(MDNS_PORT, () => {
        try {
          this.socket!.addMembership(MDNS_MULTICAST_ADDR);
        } catch {
          // multicast membership may not be supported; continue anyway
        }
      });

      if (typeof this.socket.onMessage === 'function') {
        this.socket.onMessage(onMessage);
      } else if (typeof this.socket.on === 'function') {
        this.socket.on('message', onMessage);
      }
    } catch (err) {
      console.warn('Failed to bind mDNS socket:', err);
    }
  }
}

export const mDNSDiscovery = new MDNSDiscovery();

interface UDPSocket {
  send(data: Uint8Array, port: number, host: string): void;
  bind(port: number, callback?: () => void): void;
  addMembership?(multicastAddr: string): void;
  close(): void;
  onMessage?(handler: (data: Uint8Array, rinfo: { address: string; port: number }) => void): void;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

    }

    try {
      const socket = this.createUDPSocket();
      this.socket = socket;
      this.isRunning = true;

      if (this.config.enableAnnounce) {
        this.sendAnnouncement();
        setInterval(() => {
          if (this.isRunning) {
            this.sendAnnouncement();
          }
        }, 30 * 1000).unref?.();
      }

      this.receiveLoop();
    } catch (err) {
      console.warn('mDNS discovery unavailable (UDP not supported):', err);
      this.isRunning = false;
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): DiscoveredDevice | undefined {
    return this.devices.get(deviceId);
  }