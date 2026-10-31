import { createPasswordFixture } from './passwords.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket from 'next/dist/compiled/ws/index.js';

// Isolated SSR fixture: browser requests are controlled by each test. This
// process never touches the application's database, sessions or existing rooms.
const inheritedIdentity = {
  id: 'inheritance-chennian', name: '陈念', age: 24, gender: 'FEMALE', avatarUrl: '',
};
const failedRegistrations = new Set();
// Test-only controls include SSR requests, which browser routing cannot delay.
let performanceConfig = { delays: {}, failures: {}, rooms: undefined, roomDetails: {}, user: undefined };
let performanceRequests = [];
const roomSockets = new Set();
const privateSockets = new Set();
const passwordFixture = createPasswordFixture(invalid => {
  for (const socket of [...privateSockets, ...roomSockets]) {
    if (invalid(socket.session)) { socket.send(JSON.stringify({ type: 'session.invalidated' })); socket.close(); }
  }
});
let roomSocketConnections = 0;
let roomSocketPongs = 0;
const roomSocketTickets = new Map();
let roomSocketTicketsIssued = 0;
function snapshot(socket) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (!socket.roomId) {
    if (performanceConfig.rooms === undefined) return;
    // Ownership stays private to the signed-in account, including WS snapshots.
    const items = performanceConfig.rooms.map(room => ({ ...room, canManage: Boolean(room.canManage && socket.session === 'live-test-host') }));
    socket.send(JSON.stringify({ type: 'rooms.updated', items }));
  } else if (performanceConfig.roomDetails[socket.roomId]) {
    const detail = performanceConfig.roomDetails[socket.roomId];
    socket.send(JSON.stringify({ type: 'room.updated', detail: { ...detail,
      item: { ...detail.item, canManage: Boolean(detail.item.canManage && socket.session === 'live-test-host') },
    } }));
  }
}
const inheritanceUser = (session) => session === 'inheritance-test-second' ? {
  id: 'inheritance-second-user', name: '第二测试用户', email: 'inheritance-second@example.invalid',
  gender: 'FEMALE', onboardingCompleted: true, inheritedIdentity: null,
} : ({
  id: 'inheritance-test-user', name: '继承测试用户', phone: '13800138000', email: 'inheritance-test@example.invalid',
  gender: session === 'inheritance-test-legacy' ? null : session === 'inheritance-test-male' ? 'MALE' : 'FEMALE',
  onboardingCompleted: session === 'inheritance-test-completed' || session === 'inheritance-test-inherited',
  inheritedIdentity: session === 'inheritance-test-inherited' ? inheritedIdentity : null,
});

function createFixtureNovels() {
  const chapter = { id: 'design-chapter', novelId: 'design-novel', title: '窗边的第一封信', orderIndex: 1, published: true, content: '雨停之前，她把收音机调到了熟悉的频率。街道另一端的灯还亮着。\n每一段平凡的日常，都值得有人认真倾听。'.repeat(8) };
  const novel = { id: 'design-novel', title: '雨停之前的来信', description: '一座城市，两段生活。那些未曾说出口的话，终于在一个雨夜有了回音。', status: 'ongoing', authorId: 'inheritance-test-user', author: { id: 'inheritance-test-user', name: '夜行人' }, chapterCount: 1, chapters: [chapter] };
  return [novel, { ...novel, id: 'design-novel-two', title: '在城市的另一边，等一个缓缓而来的晴天', author: { ...novel.author, name: '远山' }, status: 'completed', chapters: [{ ...chapter }] }];
}
let fixtureNovels = createFixtureNovels();

const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/health') return response.end('{}');
  if (request.url === '/__performance') {
    if (request.method === 'POST') {
      let body = ''; for await (const part of request) body += part;
      performanceConfig = { delays: {}, failures: {}, rooms: undefined, roomDetails: {}, user: undefined, ...JSON.parse(body || '{}') };
      performanceRequests = [];
      fixtureNovels = createFixtureNovels();
      for (const socket of roomSockets) snapshot(socket);
    }
    return response.end(JSON.stringify({ requests: performanceRequests, roomSockets: roomSockets.size, roomSocketConnections, roomSocketPongs, roomSocketTicketsIssued }));
  }
  if (request.url === '/__rooms/disconnect' && request.method === 'POST') {
    for (const socket of roomSockets) socket.close(1012, 'test reconnect');
    return response.end('{}');
  }
  if (request.url === '/__rooms/heartbeat' && request.method === 'POST') {
    for (const socket of roomSockets) socket.send(JSON.stringify({ type: 'ping' }));
    return response.end('{}');
  }
  const measured = { path: request.url, method: request.method, startedAt: Date.now(), finishedAt: null, abortedAt: null,
    liveVoiceTokenPresent: Boolean(request.headers['x-live-voice-token']) };
  performanceRequests.push(measured);
  performanceRequests = performanceRequests.slice(-500);
  response.once('finish', () => { measured.finishedAt = Date.now(); });
  response.once('close', () => {
    if (!response.writableFinished) measured.abortedAt = Date.now();
  });
  const delay = performanceConfig.delays[request.url] ?? 0;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (performanceConfig.failures[request.url]) {
    response.statusCode = performanceConfig.failures[request.url];
    return response.end(JSON.stringify({ error: { message: '测试接口暂时不可用' } }));
  }
  // Voice browser tests exercise the real Go handlers against temporary LiveKit
  // rooms. Existing regressions keep their isolated fixtures and mocked joins.
  const url = new URL(request.url, 'http://127.0.0.1:18181');
  const realRoomTicket = url.pathname === '/api/v1/rooms/socket-ticket' && url.searchParams.get('roomId')?.startsWith('voice-e2e-');
  if (process.env.LIVEKIT_INTEGRATION === '1' && (realRoomTicket || /^\/api\/v1\/rooms\/voice-e2e-[a-zA-Z0-9-]+(?:\/|$)/.test(request.url ?? ''))) {
    let body = '';
    for await (const part of request) body += part;
    try {
      const upstream = await fetch(`http://127.0.0.1:18182${request.url}`, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', Cookie: request.headers.cookie || '', 'X-Live-Voice-Token': request.headers['x-live-voice-token'] || '' },
        body: request.method === 'GET' ? undefined : body,
      });
      response.statusCode = upstream.status;
      if (upstream.headers.has('retry-after')) response.setHeader('Retry-After', upstream.headers.get('retry-after'));
      return response.end(await upstream.text());
    } catch {
      response.statusCode = 502;
      return response.end(JSON.stringify({ error: { message: '语音测试 API 未启动' } }));
    }
  }
  const session = request.headers.cookie?.match(/(?:^|;\s*)companion_session=([^;]+)/)?.[1];
  if (await passwordFixture.handle(request, response, session, url.pathname)) return;
  if (request.method === 'POST' && (url.pathname === '/api/v1/matches/socket-ticket' || /^\/api\/v1\/conversations\/[^/]+\/socket-ticket$/.test(url.pathname))) {
    if (!session) { response.statusCode = 401; return response.end('{}'); }
    const ticket = randomUUID();
    roomSocketTickets.set(ticket, { session, path: url.pathname.replace(/-ticket$/, ''), expires: Date.now() + 60_000 });
    return response.end(JSON.stringify({ ticket }));
  }
  if (url.pathname === '/api/v1/rooms/socket-ticket' && request.method === 'POST') {
    for (const [ticket, claims] of roomSocketTickets) {
      if (claims.expires <= Date.now()) roomSocketTickets.delete(ticket);
    }
    const ticket = randomUUID();
    roomSocketTickets.set(ticket, { session, roomId: url.searchParams.get('roomId'), expires: Date.now() + 60_000 });
    roomSocketTicketsIssued++;
    return response.end(JSON.stringify({ ticket }));
  }
  if (request.url === '/api/v1/me' && /^inheritance-test-(female|male|legacy|completed|inherited|second)$/.test(session ?? '')) {
    return response.end(JSON.stringify({ user: { ...inheritanceUser(session), ...performanceConfig.user } }));
  }
  if (['/api/v1/auth/code', '/api/v1/auth/verify'].includes(request.url) && request.method === 'POST') {
    let body = ''; for await (const part of request) body += part;
    const data = JSON.parse(body);
    if (data.phone === '13800138001') {
      response.statusCode = 409; return response.end(JSON.stringify({error:{code:'exists'}}));
    }
    if (request.url.endsWith('/code') && data.phone === '13800138009') {
      response.statusCode = 429; return response.end(JSON.stringify({ error: { code: 'rate_limit' }, retryAfter: 3 }));
    }
    if (request.url.endsWith('/code')) return response.end(JSON.stringify({sent:true,retryAfter:60}));
    if (data.code !== '123456') { response.statusCode=400; return response.end(JSON.stringify({error:{code:'invalid_code'}})); }
    return response.end(JSON.stringify({ticket:'browser-test-phone-proof'}));
  }
  if (request.url === '/api/v1/auth/login' && request.method === 'POST') {
    let body = '';
    for await (const part of request) body += part;
    const data = JSON.parse(body);
    if (passwordFixture.login(data, response)) return;
    if (!['13800138000', '13800138004'].includes(data.phone) || data.password !== 'only-for-browser-test') {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: { code: 'invalid', message: '测试账户信息不正确' } }));
    }
    const loginSession = data.phone === '13800138004' ? 'inheritance-test-female' : 'inheritance-test-second';
    response.setHeader('Set-Cookie', `companion_session=${loginSession}; HttpOnly; Path=/; SameSite=Lax`);
    return response.end(JSON.stringify({ user: inheritanceUser(loginSession) }));
  }
  if (request.url === '/api/v1/auth/register' && request.method === 'POST') {
    let body = '';
    for await (const part of request) body += part;
    const data = JSON.parse(body);
    if (!String(data.name ?? '').trim()) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: { code: 'name_required', message: '请输入昵称' } }));
    }
    if (data.phone === '13800138001') {
      response.statusCode = 409;
      return response.end(JSON.stringify({ error: { code: 'exists' } }));
    }
    if (!/^1[3-9]\d{9}$/.test(data.phone ?? '') || data.ticket !== 'browser-test-phone-proof' || !['FEMALE', 'MALE'].includes(data.gender)) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: { code: 'invalid_request', message: '测试注册信息不完整' } }));
    }
    // Fail once for each retry scenario without touching the real auth service.
    const retryKey = `${data.phone}:${data.name}`;
    if (data.phone === '13800138003' && !failedRegistrations.has(retryKey)) {
      failedRegistrations.add(retryKey);
      response.statusCode = 503;
      return response.end(JSON.stringify({ error: { code: 'unavailable' } }));
    }
    const registeredSession = data.gender === 'MALE' ? 'inheritance-test-male' : 'inheritance-test-female';
    response.setHeader('Set-Cookie', `companion_session=${registeredSession}; HttpOnly; Path=/; SameSite=Lax`);
    response.statusCode = 201;
    return response.end(JSON.stringify({ user: inheritanceUser(registeredSession) }));
  }
  if (request.url === '/api/v1/me' && request.headers.cookie?.includes('companion_session=live-test-host')) {
    return response.end(JSON.stringify({ user: { id: 'live-test-host', name: '测试主播', email: 'live-test@example.invalid' } }));
  }
  if (request.url === '/api/v1/me' && session === 'live-test-viewer') {
    return response.end(JSON.stringify({ user: { id: 'live-test-viewer', name: '登录观众', email: 'viewer@example.invalid' } }));
  }
  // Stateful novels stay in this isolated process so server-action redirects can
  // be checked against an already-cached client bookshelf without real writes.
  if (session?.startsWith('inheritance-test-') && request.url?.startsWith('/api/v1/novels')) {
    const parts = request.url.split('/').filter(Boolean);
    if (request.method === 'POST') {
      let body = ''; for await (const part of request) body += part;
      const data = JSON.parse(body || '{}');
      if (parts.length === 3) {
        const novel = { id: `fixture-novel-${fixtureNovels.length + 1}`, title: data.title, description: data.description, status: 'ongoing', authorId: 'inheritance-test-user', author: { id: 'inheritance-test-user', name: '夜行人' }, chapterCount: 0, chapters: [] };
        fixtureNovels.push(novel);
        return response.end(JSON.stringify(novel));
      }
      const novel = fixtureNovels.find(item => item.id === parts[3]);
      if (!novel) { response.statusCode = 404; return response.end('{}'); }
      if (parts[4] === 'update') Object.assign(novel, data);
      if (parts[4] === 'delete') fixtureNovels = fixtureNovels.filter(item => item.id !== novel.id);
      if (parts[4] === 'chapters') {
        if (parts.length === 5) {
          const chapter = { id: `fixture-chapter-${novel.chapters.length + 1}`, novelId: novel.id, title: data.title, content: '', orderIndex: novel.chapters.length + 1, published: false };
          novel.chapters.push(chapter);
          novel.chapterCount = novel.chapters.length;
          return response.end(JSON.stringify(chapter));
        }
        const chapter = novel.chapters.find(item => item.id === parts[5]);
        if (!chapter) { response.statusCode = 404; return response.end('{}'); }
        if (['update', 'publish'].includes(parts[6])) Object.assign(chapter, data);
        if (parts[6] === 'delete') novel.chapters = novel.chapters.filter(item => item.id !== chapter.id);
        novel.chapterCount = novel.chapters.length;
      }
      return response.end(JSON.stringify(novel));
    }
    if (parts.length === 3) return response.end(JSON.stringify({ items: fixtureNovels }));
    const novel = fixtureNovels.find(item => item.id === parts[3]);
    if (!novel) { response.statusCode = 404; return response.end('{}'); }
    if (parts.length === 4) return response.end(JSON.stringify(novel));
    const chapter = novel.chapters.find(item => item.id === parts[5]);
    if (chapter) return response.end(JSON.stringify(chapter));
    response.statusCode = 404;
    return response.end('{}');
  }
  if (request.url === '/api/v1/rooms' || request.url === '/api/v1/rooms/refresh') {
    return response.end(JSON.stringify({ items: performanceConfig.rooms ?? [] }));
  }
  const roomDetail = request.url?.match(/^\/api\/v1\/rooms\/([^/]+)(?:\/refresh)?$/);
  if (roomDetail && (request.method === 'GET' || request.url.endsWith('/refresh'))) {
    if (performanceConfig.roomDetails[roomDetail[1]]) return response.end(JSON.stringify(performanceConfig.roomDetails[roomDetail[1]]));
    const item = performanceConfig.rooms?.find(room => room.id === roomDetail[1]) ?? {
      id: roomDetail[1], title: '测试直播间', status: '准备中', viewers: 0, canManage: false,
    };
    return response.end(JSON.stringify({ item, state: 'open' }));
  }
  if (request.method === 'POST' && /^\/api\/v1\/rooms\/[^/]+\/presence$/.test(request.url ?? '')) {
    return response.end(JSON.stringify({ ok: true }));
  }
  if (request.url === '/api/v1/novels') return response.end(JSON.stringify({ items: [] }));
  response.statusCode = 401;
  response.end(JSON.stringify({ error: { message: '请先登录' } }));
});

const roomSocketServer = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://127.0.0.1:18181');
  if (url.pathname === '/api/v1/matches/socket' || /^\/api\/v1\/conversations\/[^/]+\/socket$/.test(url.pathname)) {
    const claims = roomSocketTickets.get(url.searchParams.get('ticket'));
    if (!claims || claims.path !== url.pathname || claims.expires <= Date.now() || (passwordFixture.owns(claims.session) && !passwordFixture.valid(claims.session))) return socket.destroy();
    roomSocketServer.handleUpgrade(request, socket, head, client => {
      client.session = claims.session; privateSockets.add(client);
      client.on('close', () => privateSockets.delete(client));
      client.send(JSON.stringify(url.pathname === '/api/v1/matches/socket' ? { type: 'matches.updated', items: [] } : { type: 'history', page: { items: [] } }));
    });
    return;
  }
  if (url.pathname !== '/api/v1/rooms/socket') return socket.destroy();
  const roomId = url.searchParams.get('roomId');
  const realRoom = process.env.LIVEKIT_INTEGRATION === '1' && roomId?.startsWith('voice-e2e-');
  const claims = roomSocketTickets.get(url.searchParams.get('ticket'));
  if (!realRoom && (!claims || claims.expires <= Date.now() || claims.roomId !== roomId)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  roomSocketServer.handleUpgrade(request, socket, head, client => {
    if (realRoom) {
      const upstream = new WebSocket(`ws://127.0.0.1:18182${request.url}`, { headers: {
        Origin: request.headers.origin || 'http://127.0.0.1:3012',
      } });
      const queued = [];
      client.on('message', message => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(message.toString());
        else queued.push(message.toString());
      });
      upstream.on('open', () => { for (const message of queued) upstream.send(message); });
      upstream.on('message', message => { if (client.readyState === WebSocket.OPEN) client.send(message.toString()); });
      upstream.on('close', () => client.close());
      upstream.on('error', () => client.close(1011));
      client.on('close', () => upstream.close());
      return;
    }
    roomSocketConnections++;
    client.roomId = roomId;
    // Cross-origin sockets authenticate from the ticket, never browser cookies.
    client.session = claims.session;
    roomSockets.add(client);
    client.on('close', () => roomSockets.delete(client));
    client.on('message', message => {
      try { if (JSON.parse(message.toString()).type === 'pong') roomSocketPongs++; } catch { /* ignore malformed test messages */ }
    });
    snapshot(client);
  });
});
server.listen(18181, '127.0.0.1');
