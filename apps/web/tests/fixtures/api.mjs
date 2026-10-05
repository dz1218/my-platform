import { createServer } from 'node:http';

// Isolated SSR fixture: browser requests are controlled by each test. This
// process never touches the application's database, sessions or existing rooms.
const inheritedIdentity = {
  id: 'inheritance-chennian', name: '陈念', age: 24, gender: 'FEMALE', avatarUrl: '',
};
const inheritanceUser = (session) => session === 'inheritance-test-second' ? {
  id: 'inheritance-second-user', name: '第二测试用户', email: 'inheritance-second@example.invalid',
  gender: 'FEMALE', onboardingCompleted: true, inheritedIdentity: null,
} : ({
  id: 'inheritance-test-user', name: '继承测试用户', email: 'inheritance-test@example.invalid',
  gender: session === 'inheritance-test-legacy' ? null : session === 'inheritance-test-male' ? 'MALE' : 'FEMALE',
  onboardingCompleted: session === 'inheritance-test-completed' || session === 'inheritance-test-inherited',
  inheritedIdentity: session === 'inheritance-test-inherited' ? inheritedIdentity : null,
});

createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/health') return response.end('{}');
  const session = request.headers.cookie?.match(/(?:^|;\s*)companion_session=([^;]+)/)?.[1];
  if (request.url === '/api/v1/me' && /^inheritance-test-(female|male|legacy|completed|inherited|second)$/.test(session ?? '')) {
    return response.end(JSON.stringify({ user: inheritanceUser(session) }));
  }
  if (request.url === '/api/v1/auth/login' && request.method === 'POST') {
    let body = '';
    for await (const part of request) body += part;
    const data = JSON.parse(body);
    if (data.email !== 'inheritance-second@example.invalid' || data.password !== 'only-for-browser-test') {
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
    if (data.email === 'already-registered@example.invalid') {
      response.statusCode = 409;
      return response.end(JSON.stringify({ error: { code: 'exists' } }));
    }
    if (!/^inheritance-[^@]+@example\.invalid$/.test(data.email ?? '') || !['FEMALE', 'MALE'].includes(data.gender)) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: { code: 'invalid_request', message: '测试注册信息不完整' } }));
    }
    const registeredSession = data.gender === 'MALE' ? 'inheritance-test-male' : 'inheritance-test-female';
    response.setHeader('Set-Cookie', `companion_session=${registeredSession}; HttpOnly; Path=/; SameSite=Lax`);
    response.statusCode = 201;
    return response.end(JSON.stringify({ user: inheritanceUser(registeredSession) }));
  }
  if (request.url === '/api/v1/me' && request.headers.cookie?.includes('companion_session=live-test-host')) {
    return response.end(JSON.stringify({ user: { id: 'live-test-host', name: '测试主播', email: 'live-test@example.invalid' } }));
  }
  if (request.url === '/api/v1/rooms') {
    return response.end(JSON.stringify({ items: [] }));
  }
  response.statusCode = 401;
  response.end(JSON.stringify({ error: { message: '请先登录' } }));
}).listen(18181, '127.0.0.1');
