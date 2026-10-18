import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import type { ApiRoomItem, LiveRoomDetail } from '@my-platform/shared';
import { createLiveLobbyStore, createLiveRoomStore, createLiveRoomUpdates } from '../src/live';

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const item: ApiRoomItem = { id: 'room', title: '今晚', status: '准备中', viewers: 0, canManage: true };
const detail: LiveRoomDetail = { item, state: 'open' };
const listKey = ['live-rooms', '/api'];
const detailKey = ['live-room', '/api', 'room'];

test('lobby confirms a lost close response and retains an uncertain room', async () => {
  for (const state of ['closing', 'open', undefined] as const) {
    const client = makeClient();
    client.setQueryData(listKey, [item]);
    const store = createLiveLobbyStore({ client, apiBaseUrl: '/api', isLoggedIn: true, service: {
      create: async () => ({ item }), close: async () => { throw new Error('response lost'); },
      detail: async () => { if (!state) throw new Error('offline'); return { item, state }; },
    } });
    store.getState().setRoomToClose(item);
    await store.getState().closeRoom();
    assert.deepEqual(client.getQueryData(listKey), state === 'closing' ? [] : [item]);
    assert.equal(store.getState().roomToClose, state === 'closing' ? null : item);
    if (!state) assert.match(store.getState().closeError!, /尚未确认/);
    if (state === 'open') assert.equal(store.getState().closeError, 'response lost');
    client.clear();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

test('a realtime snapshot cancels an older HTTP list and the latest snapshot wins', async () => {
  const client = makeClient();
  const response = deferred<ApiRoomItem[]>();
  let aborted = false;
  const pending = client.fetchQuery({ queryKey: listKey, queryFn: ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; });
    return response.promise;
  } }).catch(() => undefined);
  const updates = createLiveRoomUpdates(client, '/api');
  const first = updates.receive({ type: 'rooms.updated', items: [item] });
  const second = updates.receive({ type: 'rooms.updated', items: [{ ...item, viewers: 3 }] });
  await Promise.all([first, second]);
  response.resolve([]);
  await pending;
  assert.equal(aborted, true);
  assert.deepEqual(client.getQueryData(listKey), [{ ...item, viewers: 3 }]);
  updates.close();
  client.clear();
});

test('room updates are limited to their mounted room and account query client', async () => {
  const client = makeClient();
  const otherAccount = makeClient();
  client.setQueryData(detailKey, detail);
  otherAccount.setQueryData(detailKey, { ...detail, item: { ...item, canManage: false } });
  const updates = createLiveRoomUpdates(client, '/api', 'room');
  await updates.receive({ type: 'room.updated', detail: { ...detail, item: { ...item, id: 'another-room' }, state: 'closed' } });
  await updates.receive({ type: 'rooms.updated', items: [] });
  assert.equal(client.getQueryData<LiveRoomDetail>(detailKey)?.state, 'open');
  await updates.receive({ type: 'room.updated', detail: { ...detail, state: 'closing', reason: 'host_left' } });
  assert.equal(client.getQueryData<LiveRoomDetail>(detailKey)?.state, 'closing');
  assert.equal(otherAccount.getQueryData<LiveRoomDetail>(detailKey)?.state, 'open');
  assert.equal(otherAccount.getQueryData<LiveRoomDetail>(detailKey)?.item.canManage, false);
  updates.close();
  client.clear();
  otherAccount.clear();
});

test('missing room snapshots clear detail and its previous lobby entry', async () => {
  const client = makeClient();
  client.setQueryData(detailKey, detail);
  client.setQueryData(listKey, [item, { ...item, id: 'other-room' }]);
  const updates = createLiveRoomUpdates(client, '/api', 'room');
  await updates.receive({ type: 'room.missing', roomId: 'room' });
  assert.equal(client.getQueryData(detailKey), null);
  assert.deepEqual(client.getQueryData(listKey), [{ ...item, id: 'other-room' }]);
  updates.close();
  client.clear();
});

test('disposing an owner prevents pending snapshot writes and future events', async () => {
  const client = makeClient();
  client.setQueryData(listKey, []);
  const updates = createLiveRoomUpdates(client, '/api');
  const pending = updates.receive({ type: 'rooms.updated', items: [item] });
  updates.close();
  await pending;
  await updates.receive({ type: 'rooms.updated', items: [item] });
  assert.deepEqual(client.getQueryData(listKey), []);
  client.clear();
});

test('guest manual refresh guards concurrency and cannot overwrite a newer pushed list', async () => {
  const client = makeClient();
  client.setQueryData(listKey, []);
  const response = deferred<ApiRoomItem[]>();
  let requests = 0;
  const store = createLiveLobbyStore({ client, apiBaseUrl: '/api', isLoggedIn: false, service: {
    create: async () => ({ item }), close: async () => {},
    refresh: () => { requests++; return response.promise; },
  } });
  const pending = store.getState().refreshRooms();
  await store.getState().refreshRooms();
  const updates = createLiveRoomUpdates(client, '/api');
  await updates.receive({ type: 'rooms.updated', items: [item] });
  response.resolve([]);
  await pending;
  assert.equal(requests, 1);
  assert.equal(store.getState().isRefreshing, false);
  assert.deepEqual(client.getQueryData(listKey), [item]);
  updates.close();
  client.clear();
});

test('manual detail refresh cannot reopen a room closed by a newer pushed snapshot', async () => {
  const client = makeClient();
  client.setQueryData(detailKey, detail);
  const response = deferred<LiveRoomDetail>();
  let requests = 0;
  const store = createLiveRoomStore('观众', {
    dispatch: async () => {}, mediaError: () => '媒体错误',
    query: { client, apiBaseUrl: '/api', roomId: 'room' },
    refresh: () => { requests++; return response.promise; },
  });
  const pending = store.getState().refreshRoom();
  await store.getState().refreshRoom();
  const updates = createLiveRoomUpdates(client, '/api', 'room');
  await updates.receive({ type: 'room.updated', detail: { ...detail, state: 'closed', reason: 'host_left' } });
  response.resolve(detail);
  await pending;
  assert.equal(requests, 1);
  assert.equal(store.getState().isRefreshing, false);
  assert.equal(client.getQueryData<LiveRoomDetail>(detailKey)?.state, 'closed');
  updates.close();
  client.clear();
});

for (const conflict of [undefined, '你已有一个直播间，请先关闭后再创建']) {
  test(`a delayed ${conflict ? 'create conflict' : 'create success'} cannot restore a room closed by newer snapshots`, async () => {
    const client = makeClient();
    client.setQueryData(listKey, []);
    const response = deferred<{ item: ApiRoomItem; conflict?: string }>();
    const store = createLiveLobbyStore({ client, apiBaseUrl: '/api', isLoggedIn: true, service: {
      create: () => response.promise, close: async () => {},
    } });
    store.getState().setTitle(item.title);
    const pending = store.getState().createRoom();
    const updates = createLiveRoomUpdates(client, '/api');
    await updates.receive({ type: 'rooms.updated', items: [item] });
    await updates.receive({ type: 'rooms.updated', items: [] });
    response.resolve({ item, conflict });
    await pending;
    assert.deepEqual(client.getQueryData(listKey), []);
    assert.equal(store.getState().createdRoomId, null);
    assert.equal(store.getState().title, item.title);
    assert.equal(store.getState().isCreating, false);
    assert.match(store.getState().error ?? '', /状态已更新/);
    updates.close();
    client.clear();
  });
}

test('a successful create can select its still-open room without overwriting a newer snapshot', async () => {
  const client = makeClient();
  client.setQueryData(listKey, []);
  const response = deferred<{ item: ApiRoomItem }>();
  const store = createLiveLobbyStore({ client, apiBaseUrl: '/api', isLoggedIn: true, service: {
    create: () => response.promise, close: async () => {},
  } });
  store.getState().setTitle(item.title);
  const pending = store.getState().createRoom();
  const updates = createLiveRoomUpdates(client, '/api');
  const latest = { ...item, status: '直播中' as const, viewers: 4 };
  await updates.receive({ type: 'rooms.updated', items: [latest] });
  response.resolve({ item });
  await pending;
  assert.deepEqual(client.getQueryData(listKey), [latest]);
  assert.equal(store.getState().createdRoomId, item.id);
  assert.equal(store.getState().error, null);
  updates.close();
  client.clear();
});
