import type { ApiRoomItem, LiveRoomDetail, LiveRoomsUpdate, LiveUpdatesState } from '@my-platform/shared';

const CONNECT_TIMEOUT = 10_000;
const HEARTBEAT_TIMEOUT = 45_000;

function isRoom(value: unknown): value is ApiRoomItem {
  if (!value || typeof value !== 'object') return false;
  const room = value as Partial<ApiRoomItem>;
  return typeof room.id === 'string' && typeof room.title === 'string' &&
    (room.status === '直播中' || room.status === '准备中') && typeof room.viewers === 'number' && typeof room.canManage === 'boolean';
}

function isDetail(value: unknown): value is LiveRoomDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<LiveRoomDetail>;
  return isRoom(detail.item) && (detail.state === 'open' || detail.state === 'closing' || detail.state === 'closed');
}

/** One lobby or room owner creates and disposes its own connection. */
export class RoomsConnection {
  private socket?: WebSocket;
  private pending?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;
  private lastReceived = 0;

  constructor(private options: {
    roomId?: string;
    onUpdate: (event: LiveRoomsUpdate) => void;
    onState?: (state: LiveUpdatesState) => void;
  }) {
    this.options.onState?.('connecting');
    document.addEventListener('visibilitychange', this.resume);
    window.addEventListener('online', this.resume);
    window.addEventListener('offline', this.offline);
    this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    if (!navigator.onLine) { this.options.onState?.('reconnecting'); return; }
    clearTimeout(this.retry);
    this.retry = undefined;
    const pending = new AbortController();
    this.pending = pending;
    this.lastReceived = Date.now();
    this.watchdog = setTimeout(() => this.reconnect(), CONNECT_TIMEOUT);
    let socket: WebSocket;
    try {
      const endpoint = new URL('/api/live/connection', window.location.href);
      if (this.options.roomId) endpoint.searchParams.set('roomId', this.options.roomId);
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: pending.signal,
      });
      if (!response.ok) throw new Error('Room connection unavailable');
      const data: unknown = await response.json();
      if (this.stopped || this.pending !== pending) return;
      if (!data || typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string') {
        throw new Error('Invalid room connection');
      }
      const url = new URL(data.url);
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password ||
        (window.location.protocol === 'https:' && url.protocol !== 'wss:')) {
        throw new Error('Invalid room connection address');
      }
      socket = new WebSocket(url);
    } catch {
      if (!this.stopped && this.pending === pending) {
        this.pending = undefined;
        clearTimeout(this.watchdog);
        this.scheduleRetry();
      }
      return;
    }
    this.pending = undefined;
    this.socket = socket;
    this.lastReceived = Date.now();
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.reconnect(), CONNECT_TIMEOUT);
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (!data || typeof data !== 'object') throw new Error('Invalid room update');
        let snapshot: LiveRoomsUpdate | undefined;
        if (data.type === 'rooms.updated' && !this.options.roomId) {
          if (!Array.isArray(data.items) || !data.items.every(isRoom)) throw new Error('Invalid rooms snapshot');
          snapshot = data;
        } else if (data.type === 'room.updated' && this.options.roomId) {
          if (!isDetail(data.detail) || data.detail.item.id !== this.options.roomId) throw new Error('Invalid room snapshot');
          snapshot = data;
        } else if (data.type === 'room.missing' && this.options.roomId) {
          if (data.roomId !== this.options.roomId) throw new Error('Invalid missing room');
          snapshot = data;
        } else if (data.type !== 'ping') return;
        this.lastReceived = Date.now();
        clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => this.reconnect(), HEARTBEAT_TIMEOUT);
        if (data.type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); return; }
        if (snapshot) {
          this.attempts = 0;
          this.options.onState?.('connected');
          this.options.onUpdate(snapshot);
        }
      } catch { this.reconnect(); }
    };
    socket.onclose = () => { if (this.socket === socket) this.reconnect(); };
    socket.onerror = () => { if (this.socket === socket) this.reconnect(); };
  }

  private disconnect() {
    clearTimeout(this.watchdog);
    this.pending?.abort();
    this.pending = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.options.onState?.('reconnecting');
    if (!navigator.onLine || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, Math.min(1000 * 2 ** Math.min(this.attempts++, 4), 15_000));
  }

  private reconnect() { this.disconnect(); this.scheduleRetry(); }

  private resume = () => {
    if (this.stopped || document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (this.pending && Date.now() - this.lastReceived < CONNECT_TIMEOUT) return;
    if (this.socket?.readyState === WebSocket.OPEN && Date.now() - this.lastReceived < HEARTBEAT_TIMEOUT) return;
    if (this.socket?.readyState === WebSocket.CONNECTING && Date.now() - this.lastReceived < CONNECT_TIMEOUT) return;
    this.disconnect();
    this.connect();
  };

  private offline = () => {
    clearTimeout(this.retry);
    this.retry = undefined;
    this.disconnect();
    this.options.onState?.('reconnecting');
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
