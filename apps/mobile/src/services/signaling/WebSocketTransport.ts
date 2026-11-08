/**
 * WebSocketTransport.ts
 * 
 * Raw WebSocket transport with auto-reconnect, message queue, and heartbeats.
 */

export interface TransportConfig {
  url: string;
  reconnectIntervalMs: number;
  maxReconnectAttempts: number;
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
  url: 'ws://localhost:8080',
  reconnectIntervalMs: 3000,
  maxReconnectAttempts: 10,
  heartbeatIntervalMs: 15000,
  heartbeatTimeoutMs: 5000,
  messageQueueMaxSize: 100,
};

export class WebSocketTransport {
  private config: TransportConfig;
  private ws: WebSocket | null = null;
  private state: TransportState = {
    connected: false,
    reconnecting: false,
    attemptCount: 0,
    queuedMessages: 0,
  };

  private messageQueue: string[] = [];
  private handlers: {
    onMessage?: TransportMessageHandler;
    onStateChange?: TransportStateHandler;
    onError?: TransportErrorHandler;
  } = {};

  private heartbeatIntervalId: number | null = null;
  private heartbeatTimeoutId: number | null = null;
  private lastPongTime = 0;
  private reconnectTimeoutId: number | null = null;

  constructor(config: TransportConfig = defaultTransportConfig) {
    this.config = config;
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

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          this.state.connected = true;
          this.state.reconnecting = false;
          this.state.attemptCount = 0;
          this.lastPongTime = Date.now();
          this.startHeartbeat();
          this.flushQueue();
          this.notifyStateChange();
          resolve();
        };

        this.ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            this.handlers.onMessage?.call(this, event.data);
          }
        };

        this.ws.onclose = () => {
          this.state.connected = false;
          this.stopHeartbeat();
          this.notifyStateChange();
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          this.state.connected = false;
          this.stopHeartbeat();
          this.handlers.onError?.call(this, err as Error);
          reject(err as Error);
        };
      } catch (err) {
        reject(err as Error);
      }
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state.connected = false;
    this.state.reconnecting = false;
    this.notifyStateChange();
  }

  send(data: string): boolean {
    if (!this.state.connected || !this.ws) {
      if (this.messageQueue.length >= this.config.messageQueueMaxSize) {
        this.messageQueue.shift();
      }
      this.messageQueue.push(data);
      this.state.queuedMessages = this.messageQueue.length;
      this.notifyStateChange();
      return false;
    }

    try {
      this.ws.send(data);
      return true;
    } catch {
      if (this.messageQueue.length >= this.config.messageQueueMaxSize) {
        this.messageQueue.shift();
      }
      this.messageQueue.push(data);
      this.state.queuedMessages = this.messageQueue.length;
      this.notifyStateChange();
      return false;
    }
  }

  async sendReliable(data: string): Promise<boolean> {
    if (this.state.connected) {
      return this.send(data);
    }

    return new Promise((resolve) => {
      if (this.messageQueue.length >= this.config.messageQueueMaxSize) {
        this.messageQueue.shift();
      }
      this.messageQueue.push(data);
      this.state.queuedMessages = this.messageQueue.length;
      this.notifyStateChange();

      const checkInterval = setInterval(() => {
        if (this.state.connected) {
          clearInterval(checkInterval);
          resolve(this.send(data));
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 10000);
    });
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();

    this.heartbeatIntervalId = setInterval(() => {
      if (!this.state.connected || !this.ws) {
        this.stopHeartbeat();
        return;
      }

      if (Date.now() - this.lastPongTime > this.config.heartbeatTimeoutMs) {
        console.warn('WebSocket heartbeat timeout, reconnecting');
        this.ws.close();
        return;
      }

      try {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      } catch {
        // ignore
      }

      this.heartbeatTimeoutId = setTimeout(() => {
        if (Date.now() - this.lastPongTime > this.config.heartbeatTimeoutMs) {
          this.ws.close();
        }
      }, this.config.heartbeatTimeoutMs);
    }, this.config.heartbeatIntervalMs);

    const originalHandler = this.handlers.onMessage;
    this.handlers.onMessage = (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'PONG') {
          this.lastPongTime = Date.now();
        }
      } catch {
        // not JSON, ignore
      }
      originalHandler?.call(this, data);
    };
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    if (this.heartbeatTimeoutId !== null) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.isReconnectAllowed()) {
      return;
    }

    this.clearReconnectTimer();
    this.state.reconnecting = true;
    this.state.attemptCount++;
    this.notifyStateChange();

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect().catch((err) => {
        this.handlers.onError?.call(this, err);
      });
    }, this.config.reconnectIntervalMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private isReconnectAllowed(): boolean {
    return this.state.attemptCount < this.config.maxReconnectAttempts;
  }

  private notifyStateChange(): void {
    this.handlers.onStateChange?.call(this, { ...this.state });
  }
}


    const queued = [...this.messageQueue];
    this.messageQueue = [];
    this.state.queuedMessages = 0;
    this.notifyStateChange();

    for (const msg of queued) {
      try {
        this.ws.send(msg);
      } catch {
        this.messageQueue.unshift(msg);
        this.state.queuedMessages = this.messageQueue.length;
        this.notifyStateChange();
        break;
      }
    }
  }