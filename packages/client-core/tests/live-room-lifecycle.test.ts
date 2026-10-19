import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import { RoomConnectionState, type ApiRoomItem, type LiveRoomDetail, type LiveRoomJoin } from '@my-platform/shared';
import { createLiveRoomStore } from '../src/live/room';

const joined: LiveRoomJoin = {
  role: 'host', identity: 'host-session', roomId: 'room', token: 'join-token',
  voiceToken: 'voice-token', livekitUrl: 'platform-injected',
};
const defaults = { dispatch: async () => {}, mediaError: () => '媒体不可用' };
const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('a lost join response retries the same in-memory attempt and never sends concurrent joins', async () => {
  const pending = deferred<LiveRoomJoin>();
  const attempts: string[] = [];
  let ids = 0;
  const store = createLiveRoomStore(' 主播 ', { ...defaults, session: {
    createAttemptId: () => `attempt-${++ids}`,
    join: async (name, id) => {
      assert.equal(name, '主播');
      attempts.push(id);
      return attempts.length === 1 ? pending.promise : joined;
    },
  } });
  let connections = 0;
  const connect = async () => { connections++; };
  const first = store.getState().joinSession(connect);
  assert.equal(await store.getState().joinSession(connect), false);
  pending.reject(new Error('network response lost'));
  assert.equal(await first, false);
  store.getState().resetSession();
  assert.equal(await store.getState().joinSession(connect), true);
  assert.deepEqual(attempts, ['attempt-1', 'attempt-1']);
  assert.equal(ids, 1);
  assert.equal(connections, 1);
  assert.equal(store.getState().role, '主播');
  assert.equal(store.getState().isJoining, false);
  assert.equal(store.getState().joinAttemptId, null);
});

for (const [status, code, failure] of [
  [401, 'unauthorized', 'auth'],
  [409, 'host_session_in_use', 'in-use'],
  [410, 'room_closed', 'closed'],
  [404, 'room_not_found', 'missing'],
] as const) {
  test(`${code} cannot retry or fall back to a viewer connection`, async () => {
    let requests = 0;
    let connections = 0;
    const store = createLiveRoomStore('主播', { ...defaults, session: {
      createAttemptId: () => 'attempt',
      join: async () => { requests++; throw apiError(status, code); },
    } });
    const connect = async () => { connections++; };
    assert.equal(await store.getState().joinSession(connect), false);
    store.getState().resetSession();
    assert.equal(await store.getState().joinSession(connect), false);
    assert.equal(store.getState().joinFailure, failure);
    assert.equal(store.getState().role, null);
    assert.equal(store.getState().voiceToken, '');
    assert.equal(requests, 1);
    assert.equal(connections, 0);
  });
}

test('cancelled join responses cannot restore host permissions or open an SDK connection', async () => {
  const pending = deferred<LiveRoomJoin>();
  const store = createLiveRoomStore('主播', { ...defaults, session: {
    createAttemptId: () => 'attempt', join: () => pending.promise,
  } });
  let connections = 0;
  const result = store.getState().joinSession(async () => { connections++; });
  store.getState().setIsJoining(false);
  store.getState().resetSession();
  pending.resolve(joined);
  assert.equal(await result, false);
  assert.equal(connections, 0);
  assert.equal(store.getState().role, null);
  assert.equal(store.getState().voiceToken, '');
});

test('a disconnected host schedules recovery and can establish a fresh session', async () => {
  let requests = 0;
  const store = createLiveRoomStore('主播', { ...defaults, session: {
    createAttemptId: () => 'attempt', join: async () => { requests++; return joined; },
  } });
  store.getState().handleHostDisconnected();
  assert.ok(store.getState().joinRetryAt > 0);
  assert.equal(await store.getState().joinSession(async () => {}), true);
  assert.equal(requests, 1);
  assert.equal(store.getState().joinFailure, null);
});

test('ending requires host confirmation, guards duplicate requests, and closes both query caches', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const item: ApiRoomItem = { id: 'room', title: '今晚', status: '准备中', viewers: 1, canManage: true };
  client.setQueryData(['live-room', '/api', 'room'], { item, state: 'open' });
  client.setQueryData(['live-rooms', '/api'], [item]);
  const closing = deferred<void>();
  let requests = 0;
  const store = createLiveRoomStore('主播', {
    ...defaults, close: () => { requests++; return closing.promise; },
    query: { client, apiBaseUrl: '/api', roomId: 'room' },
  });
  store.getState().setRole('观众');
  store.getState().setCloseConfirmOpen(true);
  assert.equal(store.getState().closeConfirmOpen, false);
  assert.equal(await store.getState().endRoom(), false);
  store.getState().setRole('主播');
  store.getState().setConnectionState(RoomConnectionState.Connected);
  assert.equal(await store.getState().endRoom(), false);
  store.getState().setCloseConfirmOpen(true);
  const result = store.getState().endRoom();
  assert.equal(await store.getState().endRoom(), false);
  // LiveKit may disconnect before the DELETE response arrives.
  store.getState().resetSession();
  store.getState().handleHostDisconnected();
  assert.equal(store.getState().isClosing, true);
  closing.resolve();
  assert.equal(await result, true);
  assert.equal(requests, 1);
  assert.equal(store.getState().closeConfirmOpen, false);
  assert.equal(store.getState().isClosing, false);
  assert.equal(store.getState().joinFailure, 'closed');
  assert.deepEqual(client.getQueryData(['live-rooms', '/api']), []);
  assert.equal(client.getQueryData<LiveRoomDetail>(['live-room', '/api', 'room'])?.state, 'closed');
  client.clear();
});

test('a failed end keeps the active host and confirmation available for retry', async () => {
  let requests = 0;
  const store = createLiveRoomStore('主播', { ...defaults, close: async () => {
    if (++requests === 1) throw new Error('服务暂不可用');
  } });
  store.getState().setRole('主播');
  store.getState().setConnectionState(RoomConnectionState.Connected);
  store.getState().setCloseConfirmOpen(true);
  assert.equal(await store.getState().endRoom(), false);
  assert.match(store.getState().closeError!, /结束结果尚未确认/);
  assert.equal(store.getState().closeConfirmOpen, true);
  assert.equal(store.getState().connectionState, RoomConnectionState.Connected);
  assert.equal(await store.getState().endRoom(), true);
  assert.equal(requests, 2);
});

test('pending admission respects the independent 90-second wait and rate retry headers', async () => {
  const until = Date.now() + 90_000;
  const store = createLiveRoomStore('主播', { ...defaults, session: {
    createAttemptId: () => 'attempt',
    join: async () => { throw Object.assign(apiError(409, 'host_admission_pending'), { pendingUntil: until, retryAfterMs: 90_000 }); },
  } });
  await store.getState().joinSession(async () => {});
  assert.equal(store.getState().joinFailure, 'retryable');
  assert.ok(store.getState().joinRetryAt >= until);
  store.getState().cancelJoinRecovery();
  assert.equal(store.getState().joinRetryAt, 0);
});

test('a lost close response confirms closing from durable state before permitting a lobby return', async () => {
  const client = new QueryClient();
  const item: ApiRoomItem = { id: 'room', title: '今晚', status: '准备中', viewers: 1, canManage: true };
  client.setQueryData(['live-room', '/api', 'room'], { item, state: 'open' });
  const store = createLiveRoomStore('主播', { ...defaults,
    close: async () => { throw new Error('response lost'); },
    detail: async () => ({ item, state: 'closing' }),
    query: { client, apiBaseUrl: '/api', roomId: 'room' },
  });
  store.getState().setRole('主播');
  assert.equal(store.getState().requestLobbyReturn(), false);
  assert.equal(store.getState().returnToLobby, true);
  assert.equal(await store.getState().endRoom(), true);
  assert.equal(client.getQueryData<LiveRoomDetail>(['live-room', '/api', 'room'])?.state, 'closing');
  assert.equal(store.getState().closeConfirmOpen, true);
  assert.equal(store.getState().isClosing, true);
  store.getState().resetSession();
  store.getState().setCloseConfirmOpen(false);
  assert.equal(store.getState().closeConfirmOpen, true);
  assert.equal(await store.getState().endRoom(), false);
  assert.equal(store.getState().joinRetryAt, 0);
  client.clear();
});

test('an unconfirmed close stays on the page and a duplicate-page viewer never ends the host', async () => {
  let requests = 0;
  const store = createLiveRoomStore('主播', { ...defaults,
    close: async () => { requests++; throw new Error('response lost'); },
    detail: async () => { throw new Error('state unavailable'); },
  });
  store.getState().setRole('主播');
  store.getState().requestLobbyReturn();
  assert.equal(await store.getState().endRoom(), false);
  assert.equal(store.getState().closeConfirmOpen, true);
  assert.match(store.getState().closeError!, /尚未确认/);
  assert.equal(store.getState().isClosing, false);
  store.getState().setCloseConfirmOpen(false);
  assert.equal(store.getState().returnToLobby, false);
  store.getState().resetSession();
  store.getState().setIsJoining(false);
  assert.equal(store.getState().requestLobbyReturn(), true);
  assert.equal(requests, 1);
});
