export interface TransportConfig {
  url: string; reconnectIntervalMs: number; maxReconnectAttempts: number;
  heartbeatIntervalMs: number; heartbeatTimeoutMs: number; messageQueueMaxSize: number;
}
export interface TransportState { connected: boolean; reconnecting: boolean; attemptCount: number; queuedMessages: number }
export type TransportMessageHandler = (data: string) => void;
export type TransportStateHandler = (state: TransportState) => void;
export type TransportErrorHandler = (error: Error) => void;
export const defaultTransportConfig: TransportConfig = { url: 'ws://localhost:8080', reconnectIntervalMs: 3000, maxReconnectAttempts: 10, heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 5000, messageQueueMaxSize: 100 };
// Default URL is overridden at connect time via ConnectionConfig (desktop LAN host).

export class WebSocketTransport {
  private config: TransportConfig;
  private ws: WebSocket | null = null;
  private state: TransportState = { connected: false, reconnecting: false, attemptCount: 0, queuedMessages: 0 };
  private messageQueue: string[] = [];
  private handlers: { onMessage?: TransportMessageHandler; onStateChange?: TransportStateHandler; onError?: TransportErrorHandler } = {};
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastPongTime = 0;
  private explicitlyDisconnected = false;

  constructor(config: TransportConfig = defaultTransportConfig) { this.config = { ...config }; }
  setUrl(url: string): void { this.config.url = url; }
  setOnMessage(handler: TransportMessageHandler): void { this.handlers.onMessage = handler; }
  setOnStateChange(handler: TransportStateHandler): void { this.handlers.onStateChange = handler; }
  setOnError(handler: TransportErrorHandler): void { this.handlers.onError = handler; }
  getState(): TransportState { return { ...this.state }; }
  isConnected(): boolean { return this.state.connected; }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    this.explicitlyDisconnected = false;
    this.clearReconnectTimer();
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const socket = new WebSocket(this.config.url); this.ws = socket;
        socket.onopen = () => {
          settled = true; this.state.connected = true; this.state.reconnecting = false; this.state.attemptCount = 0;
          this.lastPongTime = Date.now(); this.startHeartbeat(); this.flushQueue(); this.notifyStateChange(); resolve();
        };
        socket.onmessage = event => {
          if (typeof event.data !== 'string') return;
          try { if (JSON.parse(event.data).type === 'PONG') this.lastPongTime = Date.now(); } catch { /* application handles non-JSON messages */ }
          this.handlers.onMessage?.(event.data);
        };
        socket.onerror = event => {
          const error = event instanceof Error ? event : new Error('WebSocket connection failed');
          this.handlers.onError?.(error);
          if (!settled) { settled = true; reject(error); }
        };
        socket.onclose = () => {
          if (this.ws === socket) this.ws = null;
          this.state.connected = false; this.stopHeartbeat(); this.notifyStateChange();
          if (!this.explicitlyDisconnected) this.scheduleReconnect();
        };
      } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  disconnect(): void {
    this.explicitlyDisconnected = true; this.stopHeartbeat(); this.clearReconnectTimer();
    const socket = this.ws; this.ws = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.state.connected = false; this.state.reconnecting = false; this.state.attemptCount = 0; this.notifyStateChange();
  }
  send(data: string): boolean {
    if (!this.state.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) { this.enqueue(data); return false; }
    try { this.ws.send(data); return true; }
    catch { this.enqueue(data); return false; }
  }
  async sendReliable(data: string): Promise<boolean> {
    if (this.isConnected()) return this.send(data);
    return new Promise(resolve => {
      let done = false;
      const finish = (sent: boolean) => { if (done) return; done = true; clearInterval(interval); clearTimeout(timeout); resolve(sent); };
      const interval = setInterval(() => { if (this.isConnected()) finish(this.send(data)); }, 100);
      const timeout = setTimeout(() => finish(false), 10_000);
    });
  }
  private enqueue(data: string): void {
    if (this.messageQueue.length >= this.config.messageQueueMaxSize) this.messageQueue.shift();
    this.messageQueue.push(data); this.state.queuedMessages = this.messageQueue.length; this.notifyStateChange();
  }
  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.messageQueue.length) {
      const message = this.messageQueue[0];
      try { this.ws.send(message); this.messageQueue.shift(); }
      catch { break; }
    }
    this.state.queuedMessages = this.messageQueue.length; this.notifyStateChange();
  }
  private startHeartbeat(): void {
    this.stopHeartbeat(); this.lastPongTime = Date.now();
    this.heartbeatIntervalId = setInterval(() => {
      const socket = this.ws;
      if (!this.state.connected || !socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongTime > this.config.heartbeatIntervalMs + this.config.heartbeatTimeoutMs) { socket.close(); return; }
      try { socket.send(JSON.stringify({ type: 'PING' })); } catch { socket.close(); return; }
      if (this.heartbeatTimeoutId) clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = setTimeout(() => { if (Date.now() - this.lastPongTime > this.config.heartbeatIntervalMs + this.config.heartbeatTimeoutMs) socket.close(); }, this.config.heartbeatTimeoutMs);
    }, this.config.heartbeatIntervalMs);
  }
  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
    if (this.heartbeatTimeoutId) clearTimeout(this.heartbeatTimeoutId);
    this.heartbeatIntervalId = null; this.heartbeatTimeoutId = null;
  }
  private scheduleReconnect(): void {
    if (this.explicitlyDisconnected || this.state.attemptCount >= this.config.maxReconnectAttempts) return;
    this.clearReconnectTimer(); this.state.reconnecting = true; this.state.attemptCount++; this.notifyStateChange();
    this.reconnectTimeoutId = setTimeout(() => { void this.connect().catch(error => this.handlers.onError?.(error)); }, this.config.reconnectIntervalMs);
  }
  private clearReconnectTimer(): void { if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId); this.reconnectTimeoutId = null; }
  private notifyStateChange(): void { this.handlers.onStateChange?.({ ...this.state }); }
}
