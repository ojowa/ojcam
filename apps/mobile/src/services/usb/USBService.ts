import { NativeModules, NativeEventEmitter } from 'react-native';

const { OjowacamUSB } = NativeModules;

const eventEmitter = new NativeEventEmitter();

export interface USBDeviceInfo {
  id: string;
  name: string;
  type: 'adb' | 'usb-tethering' | 'lightning';
  localPort: number;
  remotePort: number;
  isConnected: boolean;
}

export class USBService {
  private static listeners: Map<string, (data: any) => void> = new Map();
  private static isInitialized = false;

  static async initialize(): Promise<boolean> {
    if (isInitialized) return true;

    try {
      // Set up event listeners
      eventEmitter.addListener('onUSBConnected', (data) => {
        console.log('USB connected:', data);
        USBService.notifyListeners('onUSBConnected', data);
      });

      eventEmitter.addListener('onUSBDisconnected', (data) => {
        console.log('USB disconnected:', data);
        USBService.notifyListeners('onUSBDisconnected', data);
      });

      eventEmitter.addListener('onUSBDataReceived', (data) => {
        USBService.notifyListeners('onUSBDataReceived', data);
      });

      isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize USB service:', error);
      return false;
    }
  }

  static async startUSB(deviceId: string, localPort: number, remotePort: number): Promise<boolean> {
    if (!isInitialized) {
      await initialize();
    }

    try {
      await OjowacamUSB.startUSB(deviceId, localPort, remotePort);
      return true;
    } catch (error) {
      console.error('Failed to start USB:', error);
      return false;
    }
  }

  static async stopUSB(): Promise<boolean> {
    try {
      await OjowacamUSB.stopUSB();
      return true;
    } catch (error) {
      console.error('Failed to stop USB:', error);
      return false;
    }

  static async getUSBDevices(): Promise<USBDeviceInfo[]> {
    try {
      const devices = await OjowacamUSB.getUSBDevices();
      return devices as USBDeviceInfo[];
    } catch (error) {
      console.error('Failed to get USB devices:', error);
      return [];
    }
  }

  static async sendCommand(data: Uint8Array): Promise<boolean> {
    try {
      await OjowacamUSB.sendCommand(Array.from(data));
      return true;
    } catch (error) {
      console.error('Failed to send USB command:', error);
      return false;
    }
  }

  static on(event: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, callback);
      eventEmitter.addListener(event, callback);
    }
    return () => this.off(event);
  }

  static off(event: string): void {
    this.listeners.delete(event);
    eventEmitter.removeAllListeners(event);
  }

  private static notifyListeners(event: string, data: any): void {
    const callback = this.listeners.get(event);
    if (callback) {
      callback(data);
    }
  }
}

export default {
  USBService,
  initialize: USBService.initialize,
  startUSB: USBService.startUSB,
  stopUSB: USBService.stopUSB,
  getUSBDevices: USBService.getUSBDevices,
  sendCommand: USBService.sendCommand,
  on: USBService.on,
  off: USBService.off,
};
