'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';
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
async function requireAuth(): Promise<string> {
  const id = await getAuthUserId();
  if (!id) redirect('/login');
  return id;
}

export async function createNovelAction(formData: FormData) {
  const userId = await requireAuth();
  const title = ((formData.get('title') as string) ?? '').trim();
  const description = ((formData.get('description') as string) ?? '').trim();

  if (!title) redirect('/novels/create?error=missing');

  const novel = await prisma.novel.create({
    data: {
      title,
      description: description || null,
      authorId: userId,
    },
  });

  redirect(`/novels/${novel.id}`);
}

export async function updateNovelAction(formData: FormData) {
  const userId = await requireAuth();
  const novelId = formData.get('novelId') as string;
  const title = ((formData.get('title') as string) ?? '').trim();
  const description = ((formData.get('description') as string) ?? '').trim();
  const status = (formData.get('status') as string) ?? 'ongoing';

  if (!novelId || !title) redirect(`/novels/${novelId}/edit?error=missing`);

  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel || novel.authorId !== userId) redirect('/novels');

  await prisma.novel.update({
    where: { id: novelId },
    data: { title, description: description || null, status },
  });

  redirect(`/novels/${novelId}`);
}

export async function deleteNovelAction(formData: FormData) {
  const userId = await requireAuth();
  const novelId = formData.get('novelId') as string;

  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel || novel.authorId !== userId) redirect('/novels');

  await prisma.novel.delete({ where: { id: novelId } });
  redirect('/novels');
}

// ─── Chapter actions ────────────────────────────────────────────────────────

export async function createChapterAction(formData: FormData) {
  const userId = await requireAuth();
  const novelId = formData.get('novelId') as string;
  const title = ((formData.get('title') as string) ?? '').trim();

  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel || novel.authorId !== userId) redirect('/novels');
  if (!title) redirect(`/novels/${novelId}/edit?error=missing`);

  const lastChapter = await prisma.chapter.findFirst({
    where: { novelId },
    orderBy: { orderIndex: 'desc' },
  });
  const orderIndex = (lastChapter?.orderIndex ?? 0) + 1;

  const chapter = await prisma.chapter.create({
    data: { title, content: '', orderIndex, novelId },
  });

  redirect(`/novels/${novelId}/chapters/${chapter.id}/edit`);
}

export async function updateChapterAction(formData: FormData) {
  const userId = await requireAuth();
  const chapterId = formData.get('chapterId') as string;
  const title = ((formData.get('title') as string) ?? '').trim();
  const content = (formData.get('content') as string) ?? '';

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { novel: true },
  });
  if (!chapter || chapter.novel.authorId !== userId) redirect('/novels');
  if (!title) redirect(`/novels/${chapter.novelId}/chapters/${chapterId}/edit?error=missing`);

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { title, content },
  });

  redirect(`/novels/${chapter.novelId}/chapters/${chapterId}/edit?saved=1`);
}

export async function publishChapterAction(formData: FormData) {
  const userId = await requireAuth();
  const chapterId = formData.get('chapterId') as string;
  const published = formData.get('published') === '1';

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { novel: true },
  });
  if (!chapter || chapter.novel.authorId !== userId) redirect('/novels');

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { published },
  });

  redirect(`/novels/${chapter.novelId}/chapters/${chapterId}/edit`);
}

export async function deleteChapterAction(formData: FormData) {
  const userId = await requireAuth();
  const chapterId = formData.get('chapterId') as string;

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { novel: true },
  });
  if (!chapter || chapter.novel.authorId !== userId) redirect('/novels');

  await prisma.chapter.delete({ where: { id: chapterId } });
  redirect(`/novels/${chapter.novelId}/edit`);
}
