import { randomUUID } from 'node:crypto';

// Only the dedicated password fixture account is mutable. No SMS or database.
export function createPasswordFixture(revoke) {
  const phone = '13900139009';
  const user = { id: 'password-test-user', phone, name: '密码测试账户', email: '', gender: 'FEMALE', onboardingCompleted: true, inheritedIdentity: null };
  let password = 'original-password', version = 0, proof = '', sent = false, requests = 0;
  const owns = session => session?.startsWith('password-test-');
  const valid = session => session?.startsWith(`password-test-${version}-`);
  const fail = (response, code, status = 400) => { response.statusCode = status; response.end(JSON.stringify({ error: { code } })); return true; };
  const login = (data, response) => {
    if (data.phone !== phone) return false;
    if (data.password !== password) return fail(response, 'invalid', 401);
    response.setHeader('Set-Cookie', `companion_session=password-test-${version}-${randomUUID()}; HttpOnly; Path=/; SameSite=Lax`);
    response.end(JSON.stringify({ user })); return true;
  };
  return { owns, valid, login, async handle(request, response, session, path) {
    if (path === '/__password/reset' && request.method === 'POST') {
      password = 'original-password'; version = 0; proof = ''; sent = false; requests = 0;
      response.end('{}'); return true;
    }
    if (path === '/__password/state') { response.end(JSON.stringify({ version, requests })); return true; }
    if (owns(session) && !valid(session) && !path.startsWith('/api/v1/auth/')) return fail(response, 'unauthorized', 401);
    if (path === '/api/v1/me' && valid(session)) { response.end(JSON.stringify({ user })); return true; }
    if (path === '/api/v1/matches' && valid(session)) { response.end('{"items":[]}'); return true; }
    if (request.method !== 'POST' || (!path.startsWith('/api/v1/auth/password/') && path !== '/api/v1/me/password')) return false;
    let body = ''; for await (const part of request) body += part;
    const data = JSON.parse(body);
    requests++;
    if (path.endsWith('/code')) { sent = data.phone === phone; response.end('{"sent":true,"retryAfter":60}'); return true; }
    if (path.endsWith('/verify')) {
      if (!sent || data.phone !== phone || data.code !== '123456') return fail(response, 'invalid_code');
      proof = randomUUID(); response.end(JSON.stringify({ ticket: proof })); return true;
    }
    if (path === '/api/v1/me/password') {
      if (!valid(session)) return fail(response, 'unauthorized', 401);
      if (data.currentPassword !== password) return fail(response, 'invalid_current_password');
    } else if (!proof || data.ticket !== proof || data.phone !== phone) return fail(response, 'verification_expired');
    const next = data.newPassword ?? data.password;
    if (Buffer.byteLength(next) < 8 || Buffer.byteLength(next) > 72) return fail(response, 'invalid_password');
    if (next === password) return fail(response, 'same_password');
    password = next; version++; proof = ''; sent = false;
    revoke(session => owns(session) && !valid(session));
    // Exercise a revocation event arriving before the password HTTP response.
    await new Promise(resolve => setTimeout(resolve, 250));
    response.statusCode = 204; response.end(); return true;
  } };
}
