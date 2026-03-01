'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { signUserId, verifyToken } from '@/lib/auth';

// ─── Password helpers ────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
  } catch {
    return false;
  }
}

// ─── Session helper ───────────────────────────────────────────────────────────

async function setSession(userId: string, name: string) {
  const store = await cookies();
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  store.set('mp_auth', signUserId(userId), {
    httpOnly: true,
    path: '/',
    maxAge,
    sameSite: 'lax',
  });
  store.set('mp_nickname', name, {
    httpOnly: true,
    path: '/',
    maxAge,
    sameSite: 'lax',
  });
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerAction(formData: FormData) {
  const name = ((formData.get('name') as string) ?? '').trim();
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const password = (formData.get('password') as string) ?? '';
  const confirm = (formData.get('confirm') as string) ?? '';

  if (!email || !password) redirect('/register?error=missing');
  if (password !== confirm) redirect('/register?error=mismatch');
  if (password.length < 6) redirect('/register?error=weak');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect('/register?error=exists');

  const displayName = name || email.split('@')[0] || '主播';
  const user = await prisma.user.create({
    data: {
      email,
      name: displayName,
      passwordHash: hashPassword(password),
    },
  });

  await setSession(user.id, user.name ?? displayName);
  redirect('/live');
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginAction(formData: FormData) {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const password = (formData.get('password') as string) ?? '';

  if (!email || !password) redirect('/login?error=missing');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    redirect('/login?error=invalid');
  }

  await setSession(user.id, user.name ?? email.split('@')[0] ?? '主播');
  redirect('/live');
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutAction() {
  const store = await cookies();
  store.delete('mp_auth');
  store.delete('mp_nickname');
  redirect('/login');
}

// ─── Novel actions ──────────────────────────────────────────────────────────

async function requireAuth(): Promise<string> {
  const store = await cookies();
  const token = store.get('mp_auth')?.value;
  if (!token) redirect('/login');
  const userId = verifyToken(token);
  if (!userId) redirect('/login');
  return userId;
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
