import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/query-core';
import { RoomConnectionState, emptyCatalogFilters, type ApiRoomItem, type Message } from '@my-platform/shared';
import { createAuthFormStore, createChatStore, createConversationStore, createCatalogFormStore, createCompanionStore, createIdentityStore, createLiveLobbyStore, createLiveRoomStore, createLiveVoiceStore, createAutoReplyStore, subscribeCompanionFilters, validateCatalogFilters } from '../src/index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const makeIds = () => { let value = 0; return () => `request-${++value}`; };
const identity = { id: 'identity-1', name: '林', age: 25, avatarUrl: '' };
const match = { id: 'match-1', conversationId: 'conversation-1', identity };

// These tests run directly in Node: no React renderer, browser, Next or SDK.
test('account scopes own drafts and selector subscriptions, with no presentation fields', () => {
  const history = async () => ({ items: [] });
  const first = createChatStore({ history });
  const second = createChatStore({ history });
  const values: string[] = [];
  const cleanup = first.subscribe(s => s.drafts.one, value => values.push(value));
  first.getState().setDraft('one', '草稿');
  first.getState().setDraft('two', '其他会话');
  first.getState().clearSentDraft('one', '过期消息');
  assert.equal(first.getState().drafts.one, '草稿');
  assert.equal(second.getState().drafts.one, undefined);
  assert.deepEqual(values, ['草稿']);
  cleanup();
  first.getState().setDraft('one', '更新');
  assert.equal(values.length, 1);
});

test('phone verification rejects duplicate and stale results without browser state', async () => {
  const result = deferred<{ ticket: string }>();
  let calls = 0;
  const store = createAuthFormStore({ sendCode: async () => ({}), verifyCode: async () => { calls++; return result.promise; } });
  assert.equal('showPassword' in store.getState(), false);
  assert.equal('noticeOpen' in store.getState(), false);
  store.getState().setPhone('13800138000');
  const pending = store.getState().verifyPhone('123456');
  await store.getState().verifyPhone('123456');
  store.getState().setPhone('13800138001');
  store.getState().setPhone('13800138000');
  result.resolve({ ticket: 'old-ticket' });
  await pending;
  assert.equal(calls, 1);
  assert.equal(store.getState().ticket, '');
  assert.equal(store.getState().verifying, false);
});

test('conversation retries reuse injected IDs and merge server data through QueryClient', async () => {
  const client = makeClient();
  const requests: string[] = [];
  const message: Message = { id: '10', sender: { id: 'account', name: '我' }, senderType: 'user', content: '你好', status: 'complete', createdAt: '' };
  const store = createConversationStore({ client, conversationId: 'one', createRequestId: makeIds(), send: async (_content, id) => {
    requests.push(id);
    if (requests.length === 1) throw new Error('offline');
    return { message };
  } });
  await assert.rejects(store.getState().send('你好'), /offline/);
  await store.getState().send('你好');
  assert.deepEqual(requests, ['request-1', 'request-1']);
  assert.deepEqual(client.getQueryData(['messages', 'one']), { items: [message], nextCursor: undefined, replyStatus: undefined });
  assert.equal(store.getState().failedTurn, null);
  client.clear();
});

test('filter editors isolate unapplied drafts and return validated normalized values', () => {
  const applied = { ...emptyCatalogFilters, q: ' 林 ' };
  const store = createCatalogFormStore(applied);
  assert.equal('open' in store.getState(), false);
  store.getState().setDraft({ ...applied, ageMin: '40', ageMax: '20' });
  assert.equal(store.getState().prepareFilters(), null);
  store.getState().resetDraft(applied.q);
  assert.deepEqual(store.getState().prepareFilters(), { ...emptyCatalogFilters, q: '林' });
  assert.equal(applied.q, ' 林 ');
});

test('companion completion preserves cache but respects an invalidated navigation intent', async () => {
  const client = makeClient();
  client.setQueryData(['matches', 'account'], { items: [] });
  const response = deferred<typeof match>();
  let intentCurrent = true;
  let navigations = 0;
  const store = createCompanionStore({ client, accountId: 'account', isOwnerActive: () => true,
    captureNavigationIntent: () => () => intentCurrent,
    prepareChat: () => {}, openChat: () => { navigations++; }, openLogin: () => {},
    service: { meet: () => response.promise },
  });
  const pending = store.getState().meetIdentity(identity.id);
  intentCurrent = false;
  response.resolve(match);
  await pending;
  assert.deepEqual(client.getQueryData(['matches', 'account']), { items: [match] });
  assert.equal(navigations, 0);
  assert.equal('initialTab' in store.getState(), false);
  client.clear();
});

test('identity selection is a confirmation snapshot and inheritance updates shared query data', async () => {
  const client = makeClient();
  client.setQueryData(['identity-inheritance', 'account'], { identity: null, gender: null, onboardingCompleted: false, items: [] });
  const inherited: string[] = [];
  const store = createIdentityStore({ client, accountId: 'account', refresh: () => {}, openHome: () => {}, service: {
    inheritIdentity: async id => { inherited.push(id); return { identity }; },
    skipInheritance: async () => {}, setInheritanceGender: async () => {},
  } });
  store.getState().chooseIdentity({ ...identity, available: false });
  await store.getState().inheritSelected();
  assert.deepEqual(inherited, []);
  store.getState().chooseIdentity({ ...identity, available: true });
  await store.getState().inheritSelected();
  assert.deepEqual(inherited, [identity.id]);
  assert.equal(store.getState().selectedSnapshot, null);
  assert.equal((client.getQueryData(['identity-inheritance', 'account']) as { onboardingCompleted: boolean }).onboardingCompleted, true);
  client.clear();
});

test('room creation and closing enforce permissions and mutate the existing query cache', async () => {
  const client = makeClient();
  const room: ApiRoomItem = { id: 'room', title: '今晚', status: '准备中', viewers: 0, canManage: true };
  client.setQueryData(['live-rooms', '/api'], []);
  let creates = 0;
  const store = createLiveLobbyStore({ client, apiBaseUrl: '/api', isLoggedIn: true, service: {
    create: async () => { creates++; return { item: room }; }, close: async () => {},
  } });
  store.getState().setTitle(' 今晚 ');
  await store.getState().createRoom();
  await store.getState().createRoom();
  assert.equal(creates, 1);
  assert.equal('creating' in store.getState(), false);
  store.getState().setRoomToClose(room);
  await store.getState().closeRoom();
  assert.deepEqual(client.getQueryData(['live-rooms', '/api']), []);
  client.clear();
});

test('room reset invalidates late media operations and platform error descriptions are injected', async () => {
  const media = deferred<{ cameraEnabled: boolean; microphoneEnabled: boolean }>();
  const store = createLiveRoomStore('昵称', { dispatch: async () => {}, mediaError: () => '请在小程序设置中开启摄像头' });
  store.getState().setRole('主播');
  store.getState().setConnectionState(RoomConnectionState.Connected);
  await store.getState().toggleMedia('camera', async () => { throw new Error('permission'); });
  assert.equal(store.getState().error, '请在小程序设置中开启摄像头');
  const pending = store.getState().toggleMedia('camera', () => media.promise);
  store.getState().setVoiceToken('private-token');
  store.getState().resetSession();
  media.resolve({ cameraEnabled: true, microphoneEnabled: true });
  await pending;
  assert.equal(store.getState().cameraEnabled, false);
  assert.equal(store.getState().voiceToken, '');
  assert.equal(store.getState().connectionState, RoomConnectionState.Disconnected);
  assert.equal('sideTab' in store.getState(), false);
});


test('voice request IDs come from the platform and role guards survive the extraction', async () => {
  const store = createLiveVoiceStore({ createRequestId: () => 'miniapp-id' });
  const requests: string[] = [];
  const transport = { isCurrent: () => true, request: async (_action: string, id: string) => { requests.push(id); }, refresh: async () => {}, stopDevices: () => {} };
  await store.getState().act('approve', false, transport);
  await store.getState().act('request', true, transport);
  assert.deepEqual(requests, []);
  await store.getState().act('request', false, transport);
  assert.deepEqual(requests, ['miniapp-id']);
});

test('an older automatic reply response cannot overwrite a newer realtime event', async () => {
  const client = makeClient();
  const settings = { ownerType: 'AI' as const, mode: 'ALWAYS' as const, delaySeconds: 10, version: 1, canManage: true };
  client.setQueryData(['auto-reply', 'conversation'], settings);
  const response = deferred<typeof settings>();
  const store = createAutoReplyStore({ id: 'conversation', client, service: { configureAutoReply: () => response.promise, takeover: () => response.promise } });
  const pending = store.getState().change({ mode: 'TIMEOUT', delaySeconds: 30 });
  client.setQueryData(['auto-reply', 'conversation'], { ...settings, version: 3 });
  response.resolve({ ...settings, version: 2 });
  await pending;
  assert.equal((client.getQueryData(['auto-reply', 'conversation']) as typeof settings).version, 3);
  client.clear();
});


test('filter subscriptions cancel previous requests and cleanly detach from the owning view', async () => {
  const client = makeClient();
  const store = createCompanionStore({ client, accountId: 'account', isOwnerActive: () => true,
    captureNavigationIntent: () => () => true, prepareChat: () => {}, openChat: () => {}, openLogin: () => {},
    service: { meet: async () => match },
  });
  let aborted = false;
  let scrolls = 0;
  const pending = client.fetchQuery({ queryKey: ['discover', 'account', store.getState().filters], queryFn: ({ signal }) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; });
  }) });
  const rejected = assert.rejects(pending);
  const unsubscribe = subscribeCompanionFilters(store, client, 'account', () => { scrolls++; });
  store.getState().applyFilters({ ...emptyCatalogFilters, q: '林' });
  await rejected;
  assert.equal(aborted, true);
  assert.equal(scrolls, 1);
  unsubscribe();
  store.getState().applyFilters({ ...emptyCatalogFilters, q: '新朋友' });
  assert.equal(scrolls, 1);
  client.clear();
});


test('catalog validation is shared by web and mobile and matches API integer bounds', () => {
  assert.equal(validateCatalogFilters(emptyCatalogFilters), null);
  assert.equal(validateCatalogFilters({ ...emptyCatalogFilters, ageMin: '18', ageMax: '50' }), null);
  for (const ageMin of ['17', '51', '20.5', '2e1', 'invalid']) {
    assert.equal(validateCatalogFilters({ ...emptyCatalogFilters, ageMin }), '年龄请输入 18–50 之间的整数。');
  }
  assert.equal(validateCatalogFilters({ ...emptyCatalogFilters, ageMin: '40', ageMax: '20' }), '最大年龄不能小于最小年龄。');
});
