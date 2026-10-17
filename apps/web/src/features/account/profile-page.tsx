'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { redirect, useRouter } from 'next/navigation';
import { AccountPhone } from '@/components/account-phone';
import { InlineLoading } from '@/components/page-skeleton';
import { useCurrentAccount } from './use-current-account';
import { useAccountLifecycle } from './account-lifecycle';
import { ProfileContent } from './profile-content';
import './profile.css';

export function ProfilePage() {
  const user = useCurrentAccount();
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
    return <main id="main-content" tabIndex={-1} className="page-shell page-content"><InlineLoading label="正在前往登录…" /></main>;
  }

  return <main id="main-content" tabIndex={-1} className="pb-12">
    <header className="relative isolate">
      <div aria-hidden="true" className="profile-cover-media pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden opacity-80 md:h-80">
        <Image src="/images/radio-friday/profile-moonlit-sea.png" alt="" fill priority sizes="(max-width: 767px) 100vw, calc(100vw - 236px)" className="object-cover object-top" />
      </div>
      <div className="page-shell relative flex min-h-80 flex-wrap items-end gap-5 pb-8 pt-40 sm:gap-6">
        <span aria-hidden="true" className="grid size-20 shrink-0 place-items-center rounded-full border border-line bg-panel text-3xl text-ink sm:size-24 sm:text-4xl">{user.name?.slice(-1) || '我'}</span>
        <div className="min-w-0 flex-1 basis-36">
          <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{user.name || '本账户'}</h1>
          <AccountPhone phone={user.phone} />
          <p className="mt-1 text-xs leading-6 text-muted">{user.inheritedIdentity ? `AI 身份 · ${user.inheritedIdentity.name}` : '本账户'}</p>
        </div>
      </div>
    </header>
    <div className="page-shell"><ProfileContent accountId={user.id} identity={user.inheritedIdentity} /></div>
  </main>;
}
