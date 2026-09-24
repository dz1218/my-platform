import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createAgentServer } from '../server.js';

test('private API authenticates and returns JSON, never an SSE stream', async () => {
  let calls = 0;
  const server = createAgentServer('test-token', async () => { calls++; return { content: '你好', promptVersion: 'test-v1' }; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/reply`;
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal(calls, 0);
    const invalid = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: '{}' });
    assert.equal(invalid.status, 400);
    const result = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ messages: [{ role: 'system', content: 'identity' }, { role: 'user', content: 'hello' }] }) });
    assert.equal(result.status, 200); assert.match(result.headers.get('content-type')!, /application\/json/);
    assert.deepEqual(await result.json(), { content: '你好', promptVersion: 'test-v1' });
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
