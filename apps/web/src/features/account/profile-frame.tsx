'use client';

import { MobileAccountHeader, MobileAccountTabs } from '@my-platform/mobile-web/account';
import { useViewport } from '@my-platform/web-ui/use-viewport';
import Image from 'next/image';
import type { KeyboardEvent, ReactNode } from 'react';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { ConversationSkeleton } from '@/features/chat/conversation-skeleton';
import './profile.css';

export type ProfileTab = 'recent' | 'identity';
export const profileTabs: { id: ProfileTab; label: string }[] = [
  { id: 'recent', label: '最近聊天' },
  { id: 'identity', label: 'AI 身份' },
];

/** Shared geometry keeps the account wait inside the profile, not above it. */
export function ProfileFrame({ avatar, details, children }: { avatar: ReactNode; details: ReactNode; children: ReactNode }) {
  const viewport = useViewport();
  return <main id="main-content" tabIndex={-1} data-mobile-page={viewport === 'mobile' ? 'account' : undefined} className="pb-8 md:pb-12">
    {viewport === 'mobile' ? <MobileAccountHeader avatar={avatar} details={details} cover={<Image src="/images/radio-friday/profile-moonlit-sea.png" alt="" fill priority sizes="100vw" className="object-cover object-top" />} /> : <header className="relative isolate">
      <div aria-hidden="true" className="profile-cover-media pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden opacity-80 md:h-80">
        <Image src="/images/radio-friday/profile-moonlit-sea.png" alt="" fill priority sizes="(max-width: 767px) 100vw, calc(100vw - 236px)" className="object-cover object-top" />
      </div>
      <div className="page-shell relative flex min-h-80 flex-wrap items-end gap-5 pb-8 pt-40 sm:gap-6">
        <span aria-hidden="true" className="grid size-20 shrink-0 place-items-center rounded-full border border-line bg-panel text-3xl text-ink sm:size-24 sm:text-4xl">{avatar}</span>
        <div data-profile-details className="relative isolate min-h-28 min-w-0 flex-1 basis-36">{details}</div>
      </div>
    </header>}
    {/* This owner stays mounted when the header and tabs change at a breakpoint. */}
    <div className={viewport === 'mobile' ? 'px-5' : 'page-shell'}>{children}</div>
  </main>;
}

export function ProfileTabs({ tab, indicatorMotion = null, disabled = false, onSelect, onKeyDown }: {
  tab: ProfileTab;
  indicatorMotion?: 'left' | 'right' | null;
  disabled?: boolean;
  onSelect?: (tab: ProfileTab) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  const viewport = useViewport();
  if (viewport === 'mobile') return <MobileAccountTabs tab={tab} disabled={disabled} onSelect={onSelect} onKeyDown={onKeyDown} />;
  return <div className="border-b border-line/60 px-4 sm:px-6">
    <div role="tablist" aria-label="个人主页内容" className="relative inline-grid grid-cols-2 gap-2">
      {profileTabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`profile-tab-${item.id}`} aria-controls={`profile-panel-${item.id}`} aria-selected={tab === item.id} disabled={disabled} tabIndex={!disabled && tab === item.id ? 0 : -1} onClick={() => onSelect?.(item.id)} onKeyDown={event => onKeyDown?.(event, index)} className={`relative flex min-h-14 w-28 items-center justify-center px-3 text-sm font-medium leading-5 transition-colors sm:w-32 ${tab === item.id ? 'text-ink' : 'text-muted enabled:hover:text-ink'}`}>
        {item.label}
      </button>)}
      <span aria-hidden="true" className="profile-tab-indicator pointer-events-none absolute bottom-0 left-0" data-active={tab} data-direction={indicatorMotion}>
        <span className="profile-tab-line mx-5 block h-[3px] rounded-full bg-profile-tab-gradient shadow-profile-tab" />
      </span>
    </div>
  </div>;
}

export function ProfileChatHeading({ count, actions }: { count?: number; actions?: ReactNode }) {
  return <div className="mb-4 flex min-h-11 items-center justify-between gap-3">
    <h2 className="flex items-center gap-2 text-base font-semibold">你的聊天{count !== undefined && <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-line/60 bg-surface-soft/70 px-2 text-xs font-medium leading-none tabular-nums text-ink">{count}</span>}</h2>
    {actions}
  </div>;
}

/** Safe before account providers mount: no account guesses, queries or stores. */
export function ProfileLoading() {
  const viewport = useViewport();
  return <ProfileFrame avatar={<SkeletonBlock className="size-full rounded-full motion-safe:animate-pulse" />} details={<SkeletonRegion kind="profile" label="正在加载账户…" className="space-y-3">
    <SkeletonBlock className="h-8 w-40 max-w-full sm:h-9" />
    <SkeletonBlock className="h-5 w-32 max-w-full" />
    <SkeletonBlock className="h-4 w-20" />
  </SkeletonRegion>}>
    <ProfileTabs tab="recent" disabled />
    <section role="tabpanel" id="profile-panel-recent" aria-labelledby="profile-tab-recent" className="py-5 md:p-6">
      <ProfileChatHeading />
      <ConversationSkeleton layout={viewport === 'mobile' ? 'list' : 'grid'} />
    </section>
    <section role="tabpanel" id="profile-panel-identity" aria-labelledby="profile-tab-identity" hidden />
  </ProfileFrame>;
}
