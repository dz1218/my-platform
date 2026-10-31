'use client';

import { useEffect, useRef } from 'react';
import { redirect, useRouter } from 'next/navigation';
import { AccountPhone } from '@/components/account-phone';
import { LoadingPlaceholder } from '@/components/page-skeleton';
import { useCurrentAccount } from './use-current-account';
import { useAccountLifecycle } from './account-lifecycle';
import { ProfileContent } from './profile-content';
import { ProfileFrame } from './profile-frame';
import { InteractionNoticeTrigger } from '@/components/interaction-notice-dialog';
import { SubmitButton } from '@/components/submit-button';
import { usePasswordSettings } from './password-settings';
import { logoutAction } from '@/lib/actions';

export function ProfilePage() {
  const user = useCurrentAccount();
  const passwordSettings = usePasswordSettings();
  const router = useRouter();
  const { isLeavingAccount } = useAccountLifecycle();
  const redirectRequested = useRef(false);
  useEffect(() => {
    // Expiry already owns a document navigation; do not race it with a Flight.
    if (!user && !redirectRequested.current && !isLeavingAccount()) {
      redirectRequested.current = true;
      router.replace('/login');
    }
  }, [user, router, isLeavingAccount]);
  if (!user) {
    if (typeof window === 'undefined') redirect('/login');
    // This page lives in the root tab host. Commit the cleared account before
    // navigating instead of throwing a redirect through a refresh transition.
    return <main id="main-content" tabIndex={-1} className="page-shell page-content"><LoadingPlaceholder label="正在前往登录…" /></main>;
  }

  return <ProfileFrame actions={passwordSettings.trigger} avatar={user.name?.slice(-1) || '我'} details={<>
    <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{user.name || '本账户'}</h1>
    <AccountPhone phone={user.phone} />
    <p className="mt-1 text-xs leading-6 text-muted">{user.inheritedIdentity ? `AI 身份 · ${user.inheritedIdentity.name}` : '本账户'}</p>
  </>}>
    {passwordSettings.dialog}
    <ProfileContent accountId={user.id} identity={user.inheritedIdentity} />
    <footer className="mt-6 flex items-center justify-between gap-3 border-t border-line/60 pt-4 md:hidden">
      <InteractionNoticeTrigger className="inline-flex min-h-11 items-center rounded-control px-2 text-xs text-muted hover:bg-surface-soft hover:text-ink">平台互动说明</InteractionNoticeTrigger>
      <form action={logoutAction}><SubmitButton pendingLabel="正在退出…" className="min-h-11 rounded-control px-3 text-xs text-muted hover:bg-surface-soft hover:text-ink">退出登录</SubmitButton></form>
    </footer>
  </ProfileFrame>;
}
