'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { novelRequest } from '@/services/novels';
import { serverFetch, sessionCookie } from '@/services/api/server';

async function authenticate(kind: 'register' | 'login', formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (kind === 'register' && password !== formData.get('confirm')) redirect('/register?error=mismatch');
  let failure = '';
  try {
    const result = await serverFetch(`/auth/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(formData.get('email') ?? ''), name: String(formData.get('name') ?? ''), password, consent: formData.get('consent') === 'on' }),
    });
    if (!result.ok) {
      const body = await result.json();
      failure = body.error?.code ?? 'invalid';
    } else {
      const cookie = result.headers.get('set-cookie');
      const token = cookie?.match(/companion_session=([^;]+)/)?.[1];
      if (!token) throw new Error('Missing session');
      const store = await cookies();
      store.set(sessionCookie, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 });
      store.delete('mp_auth');
      store.delete('mp_nickname');
    }
  } catch { failure = 'unavailable'; }
  if (failure) redirect(`/${kind}?error=${encodeURIComponent(failure)}`);
  redirect('/companion');
}
export async function registerAction(formData: FormData) { return authenticate('register', formData); }
export async function loginAction(formData: FormData) { return authenticate('login', formData); }
export async function logoutAction() {
  const store = await cookies();
  store.delete(sessionCookie); store.delete('mp_auth'); store.delete('mp_nickname');
  redirect('/login');
}
// Form adapters only. Validation, ownership checks and persistence live in Go.
const field = (form: FormData, name: string) => String(form.get(name) ?? '');
const novelPath = (form: FormData) => `/novels/${encodeURIComponent(field(form, 'novelId'))}`;
const chapterPath = (form: FormData) => `${novelPath(form)}/chapters/${encodeURIComponent(field(form, 'chapterId'))}`;

export async function createNovelAction(form: FormData) {
  const result = await novelRequest<{ id: string }>('/novels', { title: field(form, 'title'), description: field(form, 'description') });
  redirect(`/novels/${result.id}`);
}
export async function updateNovelAction(form: FormData) {
  await novelRequest(`${novelPath(form)}/update`, { title: field(form, 'title'), description: field(form, 'description'), status: field(form, 'status') });
  redirect(novelPath(form));
}
export async function deleteNovelAction(form: FormData) {
  await novelRequest(`${novelPath(form)}/delete`, {});
  redirect('/novels');
}
export async function createChapterAction(form: FormData) {
  const result = await novelRequest<{ id: string }>(`${novelPath(form)}/chapters`, { title: field(form, 'title') });
  redirect(`${novelPath(form)}/chapters/${result.id}/edit`);
}
export async function updateChapterAction(form: FormData) {
  await novelRequest(`${chapterPath(form)}/update`, { title: field(form, 'title'), content: field(form, 'content') });
  redirect(`${chapterPath(form)}/edit?saved=1`);
}
export async function publishChapterAction(form: FormData) {
  await novelRequest(`${chapterPath(form)}/publish`, { published: field(form, 'published') === '1' });
  redirect(`${chapterPath(form)}/edit`);
}
export async function deleteChapterAction(form: FormData) {
  await novelRequest(`${chapterPath(form)}/delete`, {});
  redirect(`${novelPath(form)}/edit`);
}
