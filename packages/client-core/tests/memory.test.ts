import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import { createMemoryStore, type CompanionMemory } from '../src/chat/memory';
const memory: CompanionMemory = { id: 'm1', kind: 'FACT', content: '我住在杭州', sourceMessageId: '10', provenance: 'USER_ASSERTED', version: 3, manual: false };
test('memory workflow serializes writes, preserves failed drafts and uses the original edit version', async () => {
  const client = new QueryClient(); client.setQueryData(['memory-preferences', 'c'], { enabled: true, version: 1 });
  const calls: unknown[] = []; let finish!: () => void;
  const store = createMemoryStore({ id: 'c', client, service: { write: async (_path, body) => { calls.push(body); await new Promise<void>(resolve => { finish = resolve; }); throw new Error('version conflict'); } } });
  store.getState().edit(memory); store.getState().setDraft('我住在上海');
  const save = store.getState().save(); await store.getState().setEnabled(false);
  assert.equal(calls.length, 1); finish(); await save;
  assert.equal(store.getState().draft?.content, '我住在上海'); assert.equal(store.getState().draft?.version, 3);
  assert.match(store.getState().error, /version conflict/); client.clear();
});
test('a disposed owner cannot update another conversation or continue a stale mutation', async () => {
  const client = new QueryClient(); client.setQueryData(['memory-preferences', 'c'], { enabled: true, version: 1 });
  let finish!: () => void; let calls = 0;
  const store = createMemoryStore({ id: 'c', client, service: { write: async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); } } });
  const dispose = store.getState().activate();
  const pending = store.getState().setEnabled(false); dispose(); finish(); await pending;
  assert.equal(store.getState().notice, ''); await store.getState().setEnabled(true); assert.equal(calls, 1);
  const other = createMemoryStore({ id: 'd', client, service: { write: async () => {} } });
  assert.equal(other.getState().draft, null); assert.equal(other.getState().busy, null); client.clear();
});
test('deletion requires explicit confirmation and keeps the selected version', async () => {
  const client = new QueryClient(); const writes: unknown[] = [];
  const store = createMemoryStore({ id: 'c', client, service: { write: async (path, body) => { writes.push({ path, body }); } } });
  store.getState().requestDelete(memory); assert.equal(writes.length, 0);
  await store.getState().confirm(); assert.deepEqual(writes, [{ path: '/memories/m1/delete', body: { version: 3 } }]);
  assert.equal(store.getState().confirmation, null); client.clear();
});
