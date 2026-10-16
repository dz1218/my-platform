import type { Match } from '@/types/companion';

const CONNECT_TIMEOUT = 10_000;
// The server sends a ping every 20 seconds. A lost connection must not leave
// an apparently open socket showing an old list indefinitely.
const HEARTBEAT_TIMEOUT = 45_000;

export class MatchesConnection {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;
  private lastReceived = 0;

  constructor(private onSnapshot: (items: Match[]) => void) {
    document.addEventListener('visibilitychange', this.resume);
    window.addEventListener('online', this.resume);
    window.addEventListener('offline', this.offline);
    this.connect();
  }

  private connect() {
    if (this.stopped || !navigator.onLine) return;
    clearTimeout(this.retry);
    this.retry = undefined;
    const url = new URL('/ws/matches', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.lastReceived = Date.now();
    this.watchdog = setTimeout(() => this.reconnect(), CONNECT_TIMEOUT);
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'ping' && data.type !== 'matches.updated') return;
        this.lastReceived = Date.now();
        clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => this.reconnect(), HEARTBEAT_TIMEOUT);
        if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (!Array.isArray(data.items)) throw new Error('Invalid matches snapshot');
        // Reset backoff only after receiving data, so repeated successful
        // handshakes followed by errors do not spin at the shortest interval.
        this.attempts = 0;
        this.onSnapshot(data.items);
      } catch {
        this.reconnect();
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.reconnect();
    };
    socket.onerror = () => {
      if (this.socket === socket) this.reconnect();
    };
  }

  private disconnect() {
    clearTimeout(this.watchdog);
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }

  private scheduleRetry() {
    if (this.stopped || !navigator.onLine || this.retry) return;
    this.retry = setTimeout(
      () => { this.retry = undefined; this.connect(); },
      Math.min(1000 * 2 ** Math.min(this.attempts++, 4), 15_000),
    );
  }

  private reconnect() {
    this.disconnect();
    this.scheduleRetry();
  }

  private resume = () => {
    if (this.stopped || document.visibilityState !== 'visible' || !navigator.onLine) return;
    // Background tabs can suspend timers and miss a close event. Keep healthy
    // sockets, but replace dead or stale ones immediately when returning.
    if (this.socket?.readyState === WebSocket.OPEN && Date.now() - this.lastReceived < HEARTBEAT_TIMEOUT) return;
    if (this.socket?.readyState === WebSocket.CONNECTING && Date.now() - this.lastReceived < CONNECT_TIMEOUT) return;
    this.disconnect();
    this.connect();
  };

  private offline = () => {
    clearTimeout(this.retry);
    this.retry = undefined;
    this.disconnect();
  };

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    document.removeEventListener('visibilitychange', this.resume);
    window.removeEventListener('online', this.resume);
    window.removeEventListener('offline', this.offline);
    this.disconnect();
  }
}
