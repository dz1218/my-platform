import { expect, test } from '@playwright/test';

const cases = [
  { name: 'same-origin loopback address', host: '127.0.0.1', origin: 'http://127.0.0.1:3012', status: 401 },
  { name: 'same-origin localhost', host: 'localhost', origin: 'http://localhost:3012', status: 401 },
  { name: 'localhost origin sent to loopback address', host: '127.0.0.1', origin: 'http://localhost:3012', status: 403 },
  { name: 'loopback origin sent to localhost', host: 'localhost', origin: 'http://127.0.0.1:3012', status: 403 },
  { name: 'foreign origin', host: '127.0.0.1', origin: 'https://example.invalid', status: 403 },
  { name: 'different port', host: '127.0.0.1', origin: 'http://127.0.0.1:3013', status: 403 },
  { name: 'different protocol', host: '127.0.0.1', origin: 'https://127.0.0.1:3012', status: 403 },
  { name: 'opaque origin', host: '127.0.0.1', origin: 'null', status: 403 },
  { name: 'malformed origin', host: '127.0.0.1', origin: 'not-a-url', status: 403 },
];

// Exercise the real Next proxy. Accepted requests reach the unauthenticated
// fixture API (401); rejected requests stop at the origin guard (403).
for (const { name, host, origin, status } of cases) {
  test(`API proxy checks ${name}`, async ({ request }) => {
    const result = await request.post(`http://${host}:3012/api/v1/identity-inheritance/gender`, {
      headers: { Origin: origin },
      data: { gender: 'FEMALE' },
    });
    expect(result.status()).toBe(status);
    expect(await result.json()).toEqual({
      error: { message: status === 401 ? '请先登录' : '请求来源不允许' },
    });
  });
}
