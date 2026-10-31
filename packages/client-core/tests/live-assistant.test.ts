import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import { RoomConnectionState, type LiveRoomDetail } from '@my-platform/shared';
import { createLiveRoomStore } from '../src/live/room/store';

const key = ['live-room', '/api', 'room-one'];
const detail: LiveRoomDetail = { item: { id: 'room-one', title: '房间', status: '准备中', viewers: 1, canManage: true }, state: 'open', assistant: { status: 'idle' } };

test('assistant operations serialize, use server state and cannot overwrite a newer snapshot', async () => {
  const client = new QueryClient(); client.setQueryData(key, detail);
  let calls = 0, resolve!: (value: { status: 'starting'; sessionId: string }) => void;
  const store = createLiveRoomStore('主播', { mediaError: () => '', query: { client, apiBaseUrl: '/api', roomId: 'room-one' },
    dispatch: () => { calls++; return new Promise(r => { resolve = r; }); },
    removeAssistant: async id => { assert.equal(id, 'session-one'); return { status: 'idle' }; },
  });
  store.getState().setRole('主播'); store.getState().setConnectionState(RoomConnectionState.Connected);
  const first = store.getState().dispatchAgent();
  await store.getState().dispatchAgent(); await new Promise(r => setTimeout(r, 0)); assert.equal(calls, 1);
  client.setQueryData(key, { ...detail, assistant: { status: 'online', sessionId: 'session-one' } });
  resolve({ status: 'starting', sessionId: 'session-one' }); await first;
  assert.equal(client.getQueryData<LiveRoomDetail>(key)?.assistant?.status, 'online');
  await store.getState().dispatchAgent(); assert.equal(calls, 1);
  await store.getState().removeAgent(); assert.equal(client.getQueryData<LiveRoomDetail>(key)?.assistant?.status, 'idle');
  store.getState().setRole('观众'); await store.getState().dispatchAgent(); assert.equal(calls, 1); client.clear();
});
