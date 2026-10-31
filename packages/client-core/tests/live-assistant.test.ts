import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import { RoomConnectionState, type LiveRoomDetail } from '@my-platform/shared';
import { createLiveRoomStore } from '../src/live/room/store';
import { createLiveChatStore } from '../src/live/chat';

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

test('mention keeps the draft, is idempotent and does not silently truncate long text', () => {
  const store = createLiveChatStore({ createRequestId: () => 'id', codec: { encode: s => new TextEncoder().encode(s), decode: p => new TextDecoder().decode(p) } });
  store.getState().setDraft('我的问题'); store.getState().mentionAssistant(); store.getState().mentionAssistant();
  assert.equal(store.getState().draft, '@AI 我的问题');
  const long = '问'.repeat(500); store.getState().setDraft(long); store.getState().mentionAssistant();
  assert.equal(store.getState().draft, long); assert.ok(store.getState().error);
  const message = new TextEncoder().encode(JSON.stringify({ v: 1, id: '1', text: '回答', assistant: true }));
  store.getState().receivePayload(message, { identity: 'viewer_one', name: 'AI 助手' }, false);
  assert.equal(store.getState().messages[0].assistant, undefined);
  store.getState().receivePayload(message, { identity: 'assistant_one', name: 'AI 助手', assistant: true }, false);
  assert.equal(store.getState().messages[1].assistant, true);
  for (let i = 0; i < 25; i++) store.getState().receivePayload(message, { identity: 'assistant_one', name: 'AI 助手', assistant: true }, false);
  store.getState().receivePayload(new TextEncoder().encode(JSON.stringify({ v: 1, id: '2', text: '新的回答' })), { identity: 'assistant_one', name: 'AI 助手', assistant: true }, false);
  assert.equal(store.getState().messages.length, 3);
});
