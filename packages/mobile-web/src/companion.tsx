'use client';

import type { ReactNode } from 'react';
import { ChevronRight, MessageCircle, RefreshCw } from 'lucide-react';
import { Avatar } from '@my-platform/web-ui/avatar';
import { SkeletonBlock, SkeletonRegion } from '@my-platform/web-ui/skeleton';

export type CompanionTab = 'recent' | 'discover';

export function MobileCompanionHeading({ actions }: { actions?: ReactNode }) {
  return <header className="mb-6 flex items-start justify-between gap-3" data-mobile-page="companion">
    <div className="min-w-0"><h1 className="text-3xl font-semibold tracking-tight">陪伴</h1><p className="mt-2 text-sm leading-6 text-muted">认识一位新朋友，或继续上次没聊完的话题。</p></div>
    {actions && <div className="shrink-0">{actions}</div>}
  </header>;
}

export function MobileCompanionTabs({ tab, onSelect }: { tab: CompanionTab | null; onSelect?: (tab: CompanionTab) => void }) {
  return <nav aria-label="陪伴内容" className="mb-6 flex rounded-full bg-surface-soft p-1">
    {(['recent', 'discover'] as const).map(value => <button key={value} type="button" disabled={!onSelect} aria-pressed={tab === value} onClick={() => onSelect?.(value)} className={`min-h-11 flex-1 rounded-full px-3 text-sm transition-colors disabled:cursor-default ${tab === value ? 'bg-action font-semibold text-on-action' : 'text-muted hover:text-ink'}`}>{value === 'recent' ? '最近聊天' : '发现朋友'}</button>)}
  </nav>;
}

export function MobileRecentConversations({ children, count, refreshing = false, onRefresh, showRefresh = true, footer }: {
  children: ReactNode; count?: number; refreshing?: boolean; onRefresh?: () => void; showRefresh?: boolean; footer?: ReactNode;
}) {
  return <section aria-labelledby="mobile-recent-heading">
    <div className="mb-2 flex min-h-11 items-center gap-2"><h2 id="mobile-recent-heading" className="text-base font-semibold">接着上次的故事</h2><span className="ml-auto text-xs text-muted">{count === undefined ? '—' : `${count} 位朋友`}</span>{showRefresh && <button type="button" aria-label="刷新最近聊天" title="刷新最近聊天" disabled={!onRefresh || refreshing} onClick={onRefresh} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} /></button>}</div>
    {children}
    {footer && <div className="mt-7 border-t border-line pt-5"><p className="text-xs text-muted">也可以换一种方式放松</p><div className="mt-2 flex gap-5">{footer}</div></div>}
  </section>;
}

/** The host supplies a router-aware link, so prefetch and intercepted chat stay intact. */
export function MobileConversationSummary({ identity }: { identity: { id: string; name: string } }) {
  return <><Avatar identity={identity} large /><span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{identity.name}</span><span className="mt-1.5 block text-xs text-muted">继续你们的对话</span></span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" /></>;
}

export function MobileConversationEmpty({ guest, action }: { guest: boolean; action: ReactNode }) {
  return <div className="py-10"><MessageCircle aria-hidden="true" className="mb-5 size-9 text-accent" /><p className="text-lg text-ink">{guest ? '先认识一位朋友' : '你们的故事，从这里开始'}</p><p className="mt-3 max-w-prose text-sm leading-7 text-muted">{guest ? '登录后开始聊天，在这里继续你们的故事。' : '和一位朋友打个招呼，之后就能在这里找到你们的聊天。'}</p><div className="mt-6">{action}</div></div>;
}

export function MobileFriendCard({ identity, index, action }: {
  identity: { id: string; name: string; age: number; city?: string; occupation?: string; background?: string };
  index: number; action: ReactNode;
}) {
  return <div className="px-2"><article data-identity-id={identity.id} data-identity-index={index} className="border-b border-line py-5">
    <div className="flex items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-lg font-semibold">{identity.name}</h3><p className="mt-1 text-xs leading-5 text-muted">{identity.age} 岁{identity.city ? `，${identity.city}` : ''}{identity.occupation ? ` / ${identity.occupation}` : ''}</p></div></div>
    {identity.background && <p className="mt-3 text-sm leading-7 text-muted">{identity.background}</p>}
    <div className="mt-3 flex justify-end [&>a]:min-w-28 [&>button]:min-w-28">{action}</div>
  </article></div>;
}

export function MobileCatalogSkeleton({ label = '正在寻找可以认识的人…' }: { label?: string }) {
  return <SkeletonRegion kind="catalog" label={label}>
    {Array.from({ length: 4 }, (_, index) => <div key={index} className="border-b border-line py-5"><div className="flex items-center gap-3"><SkeletonBlock className="size-12 shrink-0 rounded-full" /><div className="flex-1"><SkeletonBlock className="h-5 w-1/3" /><SkeletonBlock className="mt-2 h-3 w-2/3" /></div></div><SkeletonBlock className="mt-4 h-4 w-full" /><SkeletonBlock className="mt-3 h-4 w-4/5" /><SkeletonBlock className="mt-4 ml-auto h-11 w-28 rounded-control" /></div>)}
  </SkeletonRegion>;
}
