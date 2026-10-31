import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordFormStore, passwordByteLength, validatePassword, type PasswordResult } from '../src/auth/password';

const services = { sendCode: async () => ({}), verifyCode: async () => ({ ticket: 'test-ticket' }) };
test('password validation counts UTF-8 bytes and matches confirmation', () => {
  assert.equal(passwordByteLength('密码🙂'), 10);
  assert.equal(validatePassword('密码🙂', '密码🙂'), '');
  assert.equal(validatePassword('密'.repeat(25), '密'.repeat(25)), 'invalid_password');
  assert.equal(validatePassword('password', 'different'), 'mismatch');
});
test('late verification cannot restore a proof for another phone or a closed form', async () => {
  let resolve!: (value: PasswordResult) => void;
  const store = createPasswordFormStore({ ...services, verifyCode: () => new Promise(done => { resolve = done; }) });
  store.getState().setField('phone', '13800138000'); store.getState().setField('code', '123456');
  const pending = store.getState().verifyPhone();
  store.getState().setField('phone', '13900139000');
  resolve({ ticket: 'old-proof' }); await pending;
  assert.equal(store.getState().ticket, '');
  store.getState().setField('code', '123456');
  const second = store.getState().verifyPhone(); store.getState().clear(); resolve({ ticket: 'closed-proof' }); await second;
  assert.equal(store.getState().ticket, ''); assert.equal(store.getState().phone, '');
});
test('sending has a concurrency guard and countdown recovers after backgrounding', async () => {
  let now = 0, calls = 0;
  let resolve!: (value: PasswordResult) => void;
  const store = createPasswordFormStore({ ...services, now: () => now, sendCode: () => { calls++; return new Promise(done => { resolve = done; }); } });
  store.getState().setField('phone', '13800138000');
  const send = store.getState().sendCode(); await store.getState().sendCode(); assert.equal(calls, 1);
  resolve({ retryAfter: 120 }); await send; assert.equal(store.getState().cooldown, 120);
  now = 91_000; store.getState().tickCooldown(); assert.equal(store.getState().cooldown, 29);
  now = 125_000; store.getState().tickCooldown(); assert.equal(store.getState().cooldown, 0);
});
test('failed submit retains fields, success clears all secrets and stores are isolated', () => {
  const a = createPasswordFormStore(services), b = createPasswordFormStore(services);
  a.getState().setField('currentPassword', 'original'); a.getState().setField('password', 'new-password'); a.getState().setField('confirm', 'new-password');
  assert.equal(a.getState().beginSubmit('change'), true); assert.equal(a.getState().beginSubmit('change'), false);
  a.getState().finishSubmit({ error: 'unavailable' }); assert.equal(a.getState().password, 'new-password');
  assert.equal(b.getState().password, ''); assert.equal(a.getState().beginSubmit('change'), true);
  a.getState().finishSubmit({ success: true });
  for (const field of ['currentPassword', 'password', 'confirm', 'ticket', 'code'] as const) assert.equal(a.getState()[field], '');
});
