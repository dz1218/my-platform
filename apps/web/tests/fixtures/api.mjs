import { createServer } from 'node:http';

// Isolated SSR fixture: browser requests are controlled by each test. This
// process never touches the application's database, sessions or existing rooms.
createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/health') return response.end('{}');
  if (request.url === '/api/v1/me' && request.headers.cookie?.includes('companion_session=live-test-host')) {
    return response.end(JSON.stringify({ user: { id: 'live-test-host', name: '测试主播', email: 'live-test@example.invalid' } }));
  }
  if (request.url === '/api/v1/rooms') {
    return response.end(JSON.stringify({ items: [] }));
  }
  response.statusCode = 401;
  response.end(JSON.stringify({ error: { message: '请先登录' } }));
}).listen(18181, '127.0.0.1');
