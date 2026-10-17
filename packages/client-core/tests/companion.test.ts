import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import type { Match } from '@my-platform/shared';
import { createCompanionStore } from '../src/companion';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const match = (id: string): Match => ({ id: `match-${id}`, conversationId: `conversation-${id}`, identity: { id, name: id, age: 25, avatarUrl: '' } });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(['matches', 'account'], { items: [] });
  const responses = new Map<string, ReturnType<typeof deferred<Match>>>();
  const calls: string[] = [];
  const opened: string[] = [];
  let generation = 0;
  const store = createCompanionStore({
    client, accountId: 'account', isOwnerActive: () => true,
    prepareChat: () => { generation++; },
    captureNavigationIntent: () => { const intent = generation; return () => intent === generation; },
    openChat: id => { opened.push(id); }, openLogin: () => {},
    service: { meet: id => { calls.push(id); const response = deferred<Match>(); responses.set(id, response); return response.promise; } },
  });
  return { client, store, responses, calls, opened };
}

for (const firstToFinish of ['a', 'b']) {
  test(`greetings are independent and only the latest intent navigates when ${firstToFinish} finishes first`, async () => {
    const { client, store, responses, calls, opened } = setup();
    try {
      const a = store.getState().meetIdentity('a');
      await store.getState().meetIdentity('a');
      const b = store.getState().meetIdentity('b');
      assert.deepEqual(calls, ['a', 'b']);
      assert.deepEqual(store.getState().pendingIds, ['a', 'b']);
      const lastToFinish = firstToFinish === 'a' ? 'b' : 'a';
      responses.get(firstToFinish)!.resolve(match(firstToFinish));
      await (firstToFinish === 'a' ? a : b);
      assert.deepEqual(store.getState().pendingIds, [lastToFinish]);
      assert.deepEqual(opened, firstToFinish === 'b' ? ['match-b'] : []);
      responses.get(lastToFinish)!.resolve(match(lastToFinish));
      await Promise.all([a, b]);
      assert.deepEqual(store.getState().pendingIds, []);
      assert.deepEqual(opened, ['match-b']);
      assert.equal(client.getQueryData<{ items: Match[] }>(['matches', 'account'])!.items.length, 2);
    } finally { client.clear(); }
  });
}

test('failed greetings release only their own button and can be retried without stale errors replacing current feedback', async () => {
  const { client, store, responses, calls, opened } = setup();
  try {
    const a = store.getState().meetIdentity('a');
    const b = store.getState().meetIdentity('b');
    responses.get('a')!.reject(new Error('stale failure'));
    await a;
    assert.deepEqual(store.getState().pendingIds, ['b']);
    assert.equal(store.getState().error, null);
    responses.get('b')!.reject(new Error('current failure'));
    await b;
    assert.equal(store.getState().error?.message, 'current failure');
    assert.deepEqual(store.getState().pendingIds, []);
    const retry = store.getState().meetIdentity('b');
    assert.equal(store.getState().error, null);
    responses.get('b')!.resolve(match('b'));
    await retry;
    assert.deepEqual(calls, ['a', 'b', 'b']);
    assert.deepEqual(opened, ['match-b']);
  } finally { client.clear(); }
});
