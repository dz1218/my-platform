'use server';

import { cookies } from 'next/headers';
import { validatePassword, type PasswordResult } from '@my-platform/client-core/auth';
import { serverFetch, sessionCookie } from '@/services/api/server';

async function request(path: string, body: object): Promise<PasswordResult> {
  try {
    const response = await serverFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status === 204) return { success: true };
    const data = await response.json();
    return response.ok ? data : { error: data.error?.code ?? 'unavailable', retryAfter: data.retryAfter };
  } catch { return { error: 'unavailable' }; }
}
export async function sendPasswordCodeAction(phone: string) { return request('/auth/password/code', { phone }); }
export async function verifyPasswordCodeAction(phone: string, code: string) { return request('/auth/password/verify', { phone, code }); }

async function updatePassword(mode: 'reset' | 'change', form: FormData): Promise<PasswordResult> {
  const password = String(form.get('password') ?? '');
  const error = validatePassword(password, String(form.get('confirm') ?? ''));
  if (error) return { error };
  const result = mode === 'reset'
    ? await request('/auth/password/reset', { phone: String(form.get('phone') ?? ''), ticket: String(form.get('ticket') ?? ''), password })
    : await request('/me/password', { currentPassword: String(form.get('currentPassword') ?? ''), newPassword: password });
  if (result.success) {
    const store = await cookies();
    store.delete(sessionCookie); store.delete('mp_auth'); store.delete('mp_nickname');
  }
  return result;
}
export async function resetPasswordAction(_state: PasswordResult, form: FormData) { return updatePassword('reset', form); }
export async function changePasswordAction(_state: PasswordResult, form: FormData) { return updatePassword('change', form); }
