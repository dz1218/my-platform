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

test('the first greeting locks every card until navigation commits, including rapid calls before a render', async () => {
  const { client, store, responses, calls, opened } = setup();
  try {
    const a = store.getState().meetIdentity('a');
    await store.getState().meetIdentity('a');
    await store.getState().meetIdentity('b');
    assert.equal(store.getState().beginEntry('known'), false);
    assert.deepEqual(calls, ['a']);
    assert.deepEqual(store.getState().pendingIds, ['a']);
    responses.get('a')!.resolve(match('a'));
    await a;
    assert.deepEqual(store.getState().pendingIds, []);
    assert.equal(store.getState().enteringId, 'a');
    await store.getState().meetIdentity('b');
    assert.equal(store.getState().beginEntry('known'), false);
    assert.deepEqual(calls, ['a']);
    assert.deepEqual(opened, ['match-a']);
    assert.equal(client.getQueryData<{ items: Match[] }>(['matches', 'account'])!.items.length, 1);
    store.getState().finishEntry();
    assert.equal(store.getState().beginEntry('known'), true);
  } finally { client.clear(); }
});

test('a failed greeting releases every card and the next attempt clears its error', async () => {
  const { client, store, responses, calls, opened } = setup();
  try {
    const a = store.getState().meetIdentity('a');
    await store.getState().meetIdentity('b');
    responses.get('a')!.reject(new Error('request failed'));
    await a;
    assert.equal(store.getState().error?.message, 'request failed');
    assert.deepEqual(store.getState().pendingIds, []);
    assert.equal(store.getState().enteringId, null);
    const retry = store.getState().meetIdentity('b');
    assert.equal(store.getState().error, null);
    responses.get('b')!.resolve(match('b'));
    await retry;
    assert.deepEqual(calls, ['a', 'b']);
    assert.deepEqual(opened, ['match-b']);
  } finally { client.clear(); }
});

test('opening an existing chat also locks other existing chats and new greetings', async () => {
  const { client, store, calls } = setup();
  try {
    assert.equal(store.getState().beginEntry('known'), true);
    assert.equal(store.getState().beginEntry('known'), false);
    assert.equal(store.getState().beginEntry('other-known'), false);
    await store.getState().meetIdentity('a');
    assert.deepEqual(calls, []);
    assert.equal(store.getState().enteringId, 'known');
    store.getState().finishEntry();
    assert.equal(store.getState().enteringId, null);
    assert.equal(store.getState().beginEntry('other-known'), true);
  } finally { client.clear(); }
});
