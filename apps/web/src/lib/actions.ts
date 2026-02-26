'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { signUserId } from '@/lib/auth';

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
