import { createServer } from 'node:http';

// Isolated SSR fixture: browser requests are controlled by each test. This
// process never touches the application's database, sessions or existing rooms.
const inheritedIdentity = {
  id: 'inheritance-chennian', name: '陈念', age: 24, gender: 'FEMALE', avatarUrl: '',
};
const failedRegistrations = new Set();
// Test-only controls include SSR requests, which browser routing cannot delay.
let performanceConfig = { delays: {}, failures: {}, rooms: undefined };
let performanceRequests = [];
const inheritanceUser = (session) => session === 'inheritance-test-second' ? {
  id: 'inheritance-second-user', name: '第二测试用户', email: 'inheritance-second@example.invalid',
  gender: 'FEMALE', onboardingCompleted: true, inheritedIdentity: null,
} : ({
  id: 'inheritance-test-user', name: '继承测试用户', phone: '13800138000', email: 'inheritance-test@example.invalid',
  gender: session === 'inheritance-test-legacy' ? null : session === 'inheritance-test-male' ? 'MALE' : 'FEMALE',
  onboardingCompleted: session === 'inheritance-test-completed' || session === 'inheritance-test-inherited',
  inheritedIdentity: session === 'inheritance-test-inherited' ? inheritedIdentity : null,
});

createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/health') return response.end('{}');
  if (request.url === '/__performance') {
    if (request.method === 'POST') {
      let body = ''; for await (const part of request) body += part;
      performanceConfig = { delays: {}, failures: {}, rooms: undefined, ...JSON.parse(body || '{}') };
      performanceRequests = [];
    }
    return response.end(JSON.stringify({ requests: performanceRequests }));
  }
  const measured = { path: request.url, method: request.method, startedAt: Date.now(), finishedAt: null };
  performanceRequests.push(measured);
  performanceRequests = performanceRequests.slice(-500);
  response.once('finish', () => { measured.finishedAt = Date.now(); });
  const delay = performanceConfig.delays[request.url] ?? 0;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (performanceConfig.failures[request.url]) {
    response.statusCode = performanceConfig.failures[request.url];
    return response.end(JSON.stringify({ error: { message: '测试接口暂时不可用' } }));
  }
  // Voice browser tests exercise the real Go handlers against temporary LiveKit
  // rooms. Existing regressions keep their isolated fixtures and mocked joins.
  if (process.env.LIVEKIT_INTEGRATION === '1' && /^\/api\/v1\/rooms\/voice-e2e-[a-zA-Z0-9-]+\//.test(request.url ?? '')) {
    let body = '';
    for await (const part of request) body += part;
    try {
      const upstream = await fetch(`http://127.0.0.1:18182${request.url}`, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', Cookie: request.headers.cookie || '', 'X-Live-Voice-Token': request.headers['x-live-voice-token'] || '' },
        body: request.method === 'GET' ? undefined : body,
      });
      response.statusCode = upstream.status;
      return response.end(await upstream.text());
    } catch {
      response.statusCode = 502;
      return response.end(JSON.stringify({ error: { message: '语音测试 API 未启动' } }));
    }
  }
  const session = request.headers.cookie?.match(/(?:^|;\s*)companion_session=([^;]+)/)?.[1];
  if (request.url === '/api/v1/me' && /^inheritance-test-(female|male|legacy|completed|inherited|second)$/.test(session ?? '')) {
    return response.end(JSON.stringify({ user: inheritanceUser(session) }));
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
    if (data.phone !== '13800138000' || data.password !== 'only-for-browser-test') {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: { code: 'invalid', message: '测试账户信息不正确' } }));
    }
    response.setHeader('Set-Cookie', 'companion_session=inheritance-test-second; HttpOnly; Path=/; SameSite=Lax');
    return response.end(JSON.stringify({ user: inheritanceUser('inheritance-test-second') }));
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
  // Deterministic server-rendered content for the dual-experience visual suite.
  if (session?.startsWith('inheritance-test-') && request.url?.startsWith('/api/v1/novels')) {
    const chapter = { id: 'design-chapter', novelId: 'design-novel', title: '窗边的第一封信', orderIndex: 1, published: true, content: '雨停之前，她把收音机调到了熟悉的频率。街道另一端的灯还亮着。\n每一段平凡的日常，都值得有人认真倾听。'.repeat(8) };
    const novel = { id: 'design-novel', title: '雨停之前的来信', description: '一座城市，两段生活。那些未曾说出口的话，终于在一个雨夜有了回音。', status: 'ongoing', authorId: 'inheritance-test-user', author: { id: 'inheritance-test-user', name: '夜行人' }, chapterCount: 1, chapters: [chapter] };
    if (request.url === '/api/v1/novels') return response.end(JSON.stringify({ items: [novel, { ...novel, id: 'design-novel-two', title: '在城市的另一边，等一个缓缓而来的晴天', author: { ...novel.author, name: '远山' }, status: 'completed' }] }));
    if (request.url === '/api/v1/novels/design-novel') return response.end(JSON.stringify(novel));
    if (request.url === '/api/v1/novels/design-novel/chapters/design-chapter') return response.end(JSON.stringify(chapter));
  }
  if (request.url === '/api/v1/rooms') {
    return response.end(JSON.stringify({ items: performanceConfig.rooms ?? [] }));
  }
  if (request.url === '/api/v1/novels') return response.end(JSON.stringify({ items: [] }));
  response.statusCode = 401;
  response.end(JSON.stringify({ error: { message: '请先登录' } }));
}).listen(18181, '127.0.0.1');
