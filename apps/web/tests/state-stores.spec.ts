import { expect, test } from '@playwright/test';
import { QueryClient } from '@tanstack/react-query';
import { ConnectionState } from 'livekit-client';
import { createChatStore, chatSelectors } from '../src/stores/chat';
import { subscribeAuthCooldown } from '../src/stores/auth/subscriptions';
import type { Message } from '../src/types/companion';
import { createAuthFormStore } from '../src/stores/auth';
import { createConversationStore } from '../src/stores/chat/conversation';
import { createCatalogFormStore } from '../src/stores/catalog';
import { createLiveChatStore, type LiveMessage } from '../src/stores/live/chat';
import { createLiveRoomStore } from '../src/stores/live/room';
import { createLiveVoiceStore } from '../src/stores/live/voice';

test('account/request scopes isolate drafts and late acknowledgements preserve new edits', () => {
  const accountA = createChatStore();
  const accountB = createChatStore();
  accountA.getState().setDraft('same-conversation', '第一条草稿');
  expect(chatSelectors.draft('same-conversation')(accountB.getState())).toBe('');
  accountA.getState().setDraft('same-conversation', '发送过程中继续编辑');
  accountA.getState().clearSentDraft('same-conversation', '第一条草稿');
  expect(chatSelectors.draft('same-conversation')(accountA.getState())).toBe('发送过程中继续编辑');
  accountA.getState().clearSentDraft('same-conversation', '发送过程中继续编辑');
  expect(accountA.getState().drafts).toEqual({});
});

test('verification responses cannot attach a ticket after the phone has changed away and back', () => {
  const form = createAuthFormStore({ sendCode: async () => ({}), verifyCode: async () => ({}) });
  form.getState().setPhone('13800138000');
  const version = form.getState().phoneVersion;
  expect(form.getState().beginVerification()).toBe(true);
  expect(form.getState().beginVerification()).toBe(false);
  form.getState().setPhone('13800138001');
  form.getState().setPhone('13800138000');
  form.getState().finishVerification(version, { ticket: 'old-ticket' });
  expect(form.getState().ticket).toBe('');
  expect(form.getState().verifying).toBe(false);
  form.getState().beginVerification();
  form.getState().finishVerification(form.getState().phoneVersion, { ticket: 'current-ticket' });
  expect(form.getState().ticket).toBe('current-ticket');
  const anotherForm = createAuthFormStore({ sendCode: async () => ({}), verifyCode: async () => ({}) });
  expect(anotherForm.getState().ticket).toBe('');
  expect(anotherForm.getState().phone).toBe('');
});

test('SMS requests exclude duplicates and old responses keep cooldown without displaying a stale notice', () => {
  const form = createAuthFormStore({ sendCode: async () => ({}), verifyCode: async () => ({}) });
  form.getState().setPhone('13800138000');
  const version = form.getState().phoneVersion;
  expect(form.getState().beginSendCode()).toBe(true);
  expect(form.getState().beginSendCode()).toBe(false);
  form.getState().setPhone('13800138001');
  form.getState().finishSendCode(version);
  expect(form.getState().notice).toBe('');
  expect(form.getState().cooldown).toBe(60);
  expect(form.getState().beginSendCode()).toBe(false);
});

test('retry uses the same request id until acceptance and is isolated between conversations', () => {
  const first = createConversationStore({ client: new QueryClient(), conversationId: 'test', send: async () => { throw new Error('offline'); } });
  const second = createConversationStore({ client: new QueryClient(), conversationId: 'test', send: async () => { throw new Error('offline'); } });
  const failed = first.getState().prepareTurn('你好');
  first.getState().failTurn(failed);
  expect(first.getState().prepareTurn('你好').requestId).toBe(failed.requestId);
  expect(second.getState().prepareTurn('你好').requestId).not.toBe(failed.requestId);
  expect(first.getState().prepareTurn('修改后的消息').requestId).not.toBe(failed.requestId);
  first.getState().completeTurn();
  expect(first.getState().prepareTurn('你好').requestId).not.toBe(failed.requestId);
});

test('unapplied filter edits do not mutate applied filters or another editor', () => {
  const applied = { q: '林', occupationCode: '', ageMin: '', ageMax: '' };
  const editor = createCatalogFormStore(applied);
  editor.getState().setDraft({ ...editor.getState().draft, occupationCode: 'designer' });
  expect(applied.occupationCode).toBe('');
  expect(createCatalogFormStore(applied).getState().draft).toEqual(applied);
  editor.getState().resetDraft(applied.q);
  expect(editor.getState().draft.q).toBe('林');
});

test('live chat deduplicates unread messages, bounds history and clears data on a new session', () => {
  const chat = createLiveChatStore();
  const message: LiveMessage = { id: 'viewer:1', identity: 'viewer', name: '观众', host: false, text: '你好', time: 1, own: false };
  chat.getState().receive(message, true);
  chat.getState().receive(message, true);
  expect(chat.getState().unread).toBe(1);
  expect(chat.getState().messages).toHaveLength(1);
  for (let i = 2; i <= 205; i++) chat.getState().receive({ ...message, id: `viewer:${i}` }, false);
  expect(chat.getState().messages).toHaveLength(200);
  chat.getState().setDraft('房间一草稿');
  chat.getState().resetSession();
  expect(chat.getState()).toMatchObject({ messages: [], draft: '', unread: 0, sending: false, error: '' });
});

test('leaving a room clears its role, permissions and media state while retaining the rejoin nickname', () => {
  const room = createLiveRoomStore('观众昵称', { dispatch: async () => {} });
  room.getState().setRole('主播');
  room.getState().setVoiceToken('room-token');
  room.getState().setConnectionState(ConnectionState.Connected);
  room.getState().setCameraEnabled(true);
  room.getState().setMicrophoneEnabled(true);
  room.getState().setSideTab('voice');
  room.getState().resetSession();
  expect(room.getState()).toMatchObject({ nickname: '观众昵称', role: null, voiceToken: '', connectionState: ConnectionState.Disconnected, cameraEnabled: false, microphoneEnabled: false, sideTab: 'chat', participants: [] });
  const voice = createLiveVoiceStore();
  voice.getState().setState({ hasHost: true, slot: { requestId: 'call-1', participantSid: 'sid', status: 'approved', requestedAt: 1, identity: 'viewer', name: '观众' } });
  voice.getState().setMicrophoneEnabled(true);
  voice.getState().resetSession();
  expect(voice.getState()).toMatchObject({ state: { slot: null, hasHost: false }, microphoneEnabled: false, cameraEnabled: false });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('selector subscriptions observe only their field and stop after unsubscribe', () => {
  const chat = createChatStore();
  const changes: Array<[string, string]> = [];
  const unsubscribe = chat.subscribe(chatSelectors.draft('first'), (next, previous) => changes.push([next, previous]));
  chat.getState().setDraft('second', '无关的会话');
  chat.getState().setDraft('first', '第一稿');
  chat.getState().setDraft('first', '第一稿');
  chat.getState().setDraft('first', '第二稿');
  expect(changes).toEqual([['第一稿', ''], ['第二稿', '第一稿']]);
  unsubscribe();
  chat.getState().setDraft('first', '解除之后');
  expect(changes).toHaveLength(2);
});

test('auth actions validate, exclude duplicate requests and ignore old verification responses', async () => {
  const sms = deferred<{ error?: string }>();
  const verification = deferred<{ ticket?: string }>();
  let sends = 0;
  let verifies = 0;
  const form = createAuthFormStore({
    sendCode: async () => { sends++; return sms.promise; },
    verifyCode: async () => { verifies++; return verification.promise; },
  });
  expect(await form.getState().sendCode()).toBe('invalid_phone');
  expect(sends).toBe(0);
  form.getState().setPhone('13800138000');
  const pending = form.getState().sendCode();
  await form.getState().sendCode();
  expect(sends).toBe(1);
  sms.resolve({});
  await pending;
  expect(form.getState()).toMatchObject({ sending: false, cooldown: 60 });
  const verify = form.getState().verifyPhone('123456');
  await form.getState().verifyPhone('123456');
  expect(verifies).toBe(1);
  form.getState().setPhone('13800138001');
  form.getState().setPhone('13800138000');
  verification.resolve({ ticket: 'old-ticket' });
  await verify;
  expect(form.getState()).toMatchObject({ verifying: false, ticket: '' });
});

test('cooldown subscription cleanup cancels pending ticks and can be bound again', async () => {
  const form = createAuthFormStore({ sendCode: async () => ({}), verifyCode: async () => ({}) });
  form.getState().setPhone('13800138000');
  const unsubscribe = subscribeAuthCooldown(form);
  await form.getState().sendCode();
  unsubscribe();
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(form.getState().cooldown).toBe(60);
  const rebound = subscribeAuthCooldown(form);
  try { await expect.poll(() => form.getState().cooldown).toBe(59); }
  finally { rebound(); }
});

test('conversation send action retains retry id, prevents duplicates and merges acceptance into query data', async () => {
  const first = deferred<{ message: Message }>();
  const accepted: Message = { id: '123', sender: { id: 'me', name: '我' }, senderType: 'user', content: '你好', status: 'complete', createdAt: new Date().toISOString() };
  const requests: string[] = [];
  const client = new QueryClient();
  const conversation = createConversationStore({ client, conversationId: 'one', send: async (_text, requestId) => {
    requests.push(requestId);
    return requests.length === 1 ? first.promise : { message: accepted };
  } });
  const sending = conversation.getState().send('你好');
  await expect(conversation.getState().send('重复')).rejects.toThrow('消息正在发送');
  const failure = expect(sending).rejects.toThrow('offline');
  first.reject(new Error('offline'));
  await failure;
  expect(conversation.getState().outgoing).toBeNull();
  await conversation.getState().send('你好');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBe(requests[0]);
  expect(conversation.getState()).toMatchObject({ failedTurn: null, outgoing: null, sendError: null });
  expect(client.getQueryData(['messages', 'one'])).toMatchObject({ items: [accepted] });
});

test('room operations enforce role and ignore late dispatch/media results after leaving', async () => {
  const dispatch = deferred<void>();
  let calls = 0;
  const room = createLiveRoomStore('主播', { dispatch: async () => { calls++; return dispatch.promise; } });
  await room.getState().dispatchAgent();
  expect(calls).toBe(0);
  room.getState().setRole('主播');
  room.getState().setConnectionState(ConnectionState.Connected);
  const pending = room.getState().dispatchAgent();
  await room.getState().dispatchAgent();
  expect(calls).toBe(1);
  const media = deferred<{ cameraEnabled: boolean; microphoneEnabled: boolean }>();
  const enabling = room.getState().toggleMedia('camera', () => media.promise);
  room.getState().resetSession();
  dispatch.resolve();
  media.resolve({ cameraEnabled: true, microphoneEnabled: true });
  await Promise.all([pending, enabling]);
  expect(room.getState()).toMatchObject({ agentRequested: false, isDispatchingAgent: false, cameraEnabled: false, microphoneEnabled: false, mediaBusy: null });
});

test('live chat validates payloads and old publish completion cannot overwrite a new session', async () => {
  const chat = createLiveChatStore();
  const author = { identity: 'viewer', name: '观众' };
  for (const text of ['invalid JSON', '{"v":1,"id":"1","text":""}', '{"v":2,"id":"1","text":"你好"}']) {
    chat.getState().receivePayload(new TextEncoder().encode(text), author, true);
  }
  expect(chat.getState().messages).toHaveLength(0);
  const publish = deferred<void>();
  let calls = 0;
  chat.getState().setDraft('发送前的草稿');
  const pending = chat.getState().sendMessage(author, async () => { calls++; return publish.promise; });
  expect(await chat.getState().sendMessage(author, async () => { calls++; })).toBe(false);
  expect(calls).toBe(1);
  chat.getState().resetSession();
  chat.getState().setDraft('新会话的草稿');
  publish.resolve();
  expect(await pending).toBe(false);
  expect(chat.getState()).toMatchObject({ messages: [], draft: '新会话的草稿', sending: false, error: '' });
});

test('voice actions enforce host controls, serialize requests and discard stale session errors', async () => {
  const voice = createLiveVoiceStore();
  const response = deferred<void>();
  const requests: Array<{ action: string; requestId: string }> = [];
  const transport = {
    isCurrent: () => true,
    request: async (action: string, requestId: string) => { requests.push({ action, requestId }); return response.promise; },
    refresh: async () => {}, stopDevices: () => {},
  };
  await voice.getState().act('approve', false, transport);
  await voice.getState().act('request', true, transport);
  expect(requests).toHaveLength(0);
  const pending = voice.getState().act('request', false, transport);
  await voice.getState().act('request', false, transport);
  expect(requests).toHaveLength(1);
  expect(requests[0].requestId).toBeTruthy();
  voice.getState().resetSession();
  response.reject(new Error('旧房间的错误'));
  await pending;
  expect(voice.getState()).toMatchObject({ busy: false, error: '', state: { slot: null, hasHost: false } });
});


test('web presentation composition supplies a complete stable SSR snapshot without sharing form state', () => {
  const services = { sendCode: async () => ({}), verifyCode: async () => ({}) };
  const form = createAuthFormStore(services);
  const secondForm = createAuthFormStore(services);
  const initial = form.getInitialState();
  expect(form.getState()).toBe(initial);
  expect(initial).toMatchObject({ phone: '', showPassword: false, noticeOpen: false });
  expect(initial.setShowPassword).toEqual(expect.any(Function));
  const changes: boolean[] = [];
  const unsubscribe = form.subscribe(s => s.showPassword, value => changes.push(value));
  form.getState().setPhone('13800138000');
  form.getState().setShowPassword(true);
  form.getState().setNoticeOpen(true);
  expect(form.getInitialState()).toBe(initial);
  expect(initial).toMatchObject({ phone: '', showPassword: false, noticeOpen: false });
  expect(secondForm.getState()).toMatchObject({ phone: '', showPassword: false, noticeOpen: false });
  expect(changes).toEqual([true]);
  unsubscribe();
  form.getState().setShowPassword(false);
  expect(changes).toEqual([true]);
});

test('room reset updates business and presentation atomically and preserves fullscreen ownership', () => {
  const room = createLiveRoomStore('昵称', { dispatch: async () => {} });
  const initial = room.getInitialState();
  expect(initial).toMatchObject({ sideTab: 'chat', isFullscreen: false, sessionVersion: 0 });
  room.getState().setRole('主播');
  room.getState().setConnectionState(ConnectionState.Connected);
  room.getState().setSideTab('voice');
  room.getState().setIsFullscreen(true);
  const seen: Array<{ role: string | null; sideTab: string; isFullscreen: boolean }> = [];
  const unsubscribe = room.subscribe(s => s.sessionVersion, () => {
    const { role, sideTab, isFullscreen } = room.getState();
    seen.push({ role, sideTab, isFullscreen });
  });
  room.getState().resetSession();
  expect(seen).toEqual([{ role: null, sideTab: 'chat', isFullscreen: true }]);
  expect(room.getState().setSideTab).toEqual(expect.any(Function));
  expect(room.getInitialState()).toBe(initial);
  expect(initial).toMatchObject({ sideTab: 'chat', isFullscreen: false, sessionVersion: 0 });
  unsubscribe();
});
