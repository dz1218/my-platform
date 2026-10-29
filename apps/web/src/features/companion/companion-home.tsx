'use client';
import Link from 'next/link';
import { MatchLink } from '@/features/chat/match-link';
import { CatalogSkeleton } from '@/features/catalog/catalog-skeleton';
import { ConversationSkeleton } from '@/features/chat/conversation-skeleton';
import { ChevronRight, MessageCircle, RefreshCw } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useAuthExit } from '@/features/auth/auth-exit-transition';
import { useAppUI } from '@/stores/provider';
import { useBrowseNavigation } from '@/components/browse-navigation';
import { CompanionHeading, CompanionScene, CompanionLoadingContent } from './companion-frame';
import { RecentConversationsFrame } from './recent-conversations-frame';
import { useViewport } from '@/components/use-viewport';
import { Avatar } from '@/features/identity/avatar';
import { IdentityModeSwitch } from '@/features/identity/identity-mode-switch';
import { CatalogFilters, MobileCatalogFilters } from '@/features/catalog/catalog-filters';
import { IdentityMasonry } from '@/features/catalog/identity-masonry';
import { FriendCard } from './friend-card';
import { useCompanionHome, type CompanionModel } from './use-companion-home';
import type { Identity } from '@/types/companion';
import { MobileCompanionHeading, MobileCatalogSkeleton } from '@my-platform/mobile-web/companion';
import { MobileFriendCardAdapter } from './friend-card';
import { MobilePullToRefresh } from '@my-platform/mobile-web/pull-to-refresh';

export function CompanionHome({ accountId, inheritedIdentity }: { accountId: string | null; inheritedIdentity?: Identity | null }) {
  // The controller is intentionally above both presentations and survives resizing.
  const model = useCompanionHome(accountId, inheritedIdentity);
  const currentViewport = useViewport();
  const lastViewport = useRef(currentViewport);
  if (!model.paused) lastViewport.current = currentViewport;
  // A hidden host keeps its measured presentation until it becomes active.
  const viewport = model.paused ? lastViewport.current : currentViewport;
  const layoutReady = useAppUI(s => s.layoutReady);
  const { onHomeReady } = useAuthExit();
  useLayoutEffect(() => {
    // A route loading boundary can commit before this page mounts. The auth
    // transition needs the actual heading and final viewport/sidebar layout.
    if (viewport && layoutReady && !model.paused) onHomeReady();
  }, [viewport, layoutReady, model.paused, onHomeReady]);
  if (!viewport) return <main id={model.paused ? undefined : 'main-content'} tabIndex={-1} className="page-shell page-content"><CompanionLoadingContent /></main>;
  return <main id={model.paused ? undefined : 'main-content'} tabIndex={-1} className="page-shell page-content">
    <MobilePullToRefresh enabled={viewport === 'mobile' && !model.paused} label="人物目录" busy={model.identities.isFetching} onRefresh={() => model.identities.refetch({ throwOnError: true, cancelRefetch: false })} />
    {viewport === 'mobile' ? <MobileCompanionHeading actions={!model.isLoggedIn && <Link href="/login" className="btn-secondary">登录 / 注册</Link>} /> : <CompanionHeading />}
    {inheritedIdentity && <IdentityModeSwitch identity={inheritedIdentity} />}
    {model.error && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{model.error.message}</span><button className="min-h-11 shrink-0 hover:text-danger-hover" onClick={model.retry}>重试</button></div>}
    {viewport === 'desktop' ? <DesktopCompanion model={model} /> : <Discovery model={model} mobile />}
  </main>;
}

function DesktopCompanion({ model }: { model: CompanionModel }) {
  return <>
    <CompanionScene />
    <div className="companion-layout"><Discovery model={model} /><aside aria-label="最近聊天" className="conversation-rail"><RecentConversations model={model} onDiscover={() => model.heading.current?.scrollIntoView({ behavior: 'smooth' })} /></aside></div>
  </>;
}

function Discovery({ model: m, mobile = false }: { model: CompanionModel; mobile?: boolean }) {
  const { restorationPending } = useBrowseNavigation();
  return <section aria-labelledby="discover-heading" className="min-w-0">
    <div ref={m.heading} className={mobile ? 'relative' : 'section-heading'}><h2 id="discover-heading" className={mobile ? 'sr-only' : 'text-base font-semibold'}>这里的朋友</h2>{!mobile && <div className="flex items-center gap-3"><span className="text-xs font-normal text-muted">{m.page ? `${m.page.total} 位朋友` : '按自己的节奏来'}</span><button type="button" aria-label="刷新人物目录" title="刷新人物目录" disabled={m.identities.isFetching} onClick={() => void m.identities.refetch()} className="grid size-11 place-items-center rounded-control text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${m.identities.isFetching ? 'motion-safe:animate-spin' : ''}`} /></button></div>}</div>
    {mobile ? <MobileCatalogFilters anchored active={!m.paused} value={m.filters} occupations={m.page?.occupations ?? []} onChange={m.applyFilters} /> : <CatalogFilters value={m.filters} occupations={m.page?.occupations ?? []} onChange={m.applyFilters} />}
    {m.identities.isError && !m.identities.isFetchNextPageError && <div role="alert" className="my-4 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{m.identities.data ? '人物目录更新失败，已保留上次内容。' : '人物目录暂时加载失败。'}{m.identities.error.message}</span><button type="button" disabled={m.identities.isFetching} className="min-h-11 shrink-0 hover:text-danger-hover disabled:opacity-50" onClick={() => void m.identities.refetch()}>重试</button></div>}
    {m.identities.isPending && (mobile ? <MobileCatalogSkeleton /> : <CatalogSkeleton />)}
    {!m.identities.isPending && !m.identities.error && m.friends.length === 0 && <p className="empty-state">没有找到符合条件的朋友，试试其他筛选条件。</p>}
    {/* Each filter result owns its measurements; cached results must not reuse a shorter list's column ranges. */}
    <IdentityMasonry key={JSON.stringify(m.filters)} items={m.friends} context={m.cardContext} ItemContent={mobile ? MobileFriendCardAdapter : FriendCard} paused={m.paused} autoLoad={!restorationPending && !m.identities.isRefetchError} mobileColumns={2} gutter={mobile ? 12 : 16} hasNextPage={m.identities.hasNextPage} loading={m.identities.isFetchingNextPage} error={m.identities.isFetchNextPageError ? m.identities.error : null} loadMore={m.loadMore} />
    <p className="mt-6 max-w-prose text-xs leading-6 text-muted">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 text-accent hover:text-ink">了解互动方式</Link></p>
  </section>;
}

function RecentConversations({ model: m, onDiscover }: { model: CompanionModel; onDiscover: () => void }) {
  return <RecentConversationsFrame count={m.recent?.length} showRefresh={m.isLoggedIn} refreshing={m.conversations.isFetching} onRefresh={() => void m.conversations.refetch()}>
    {!m.isLoggedIn ? <div className="py-10"><MessageCircle aria-hidden="true" className="mb-5 size-9 text-accent" /><p className="text-lg text-ink">先认识一位朋友</p><p className="mt-3 text-sm leading-7 text-muted">登录后开始聊天，在这里继续你们的故事。</p><Link href="/login" className="btn-secondary mt-6">登录后聊天</Link></div> : m.conversations.isPending ? <ConversationSkeleton /> : m.recent?.length ? <ul className="grid gap-1">{m.recent.map(match => <li key={match.id}><MatchLink match={match} scroll={false} onClick={m.prepareChat} className="flex min-w-0 items-center gap-4 rounded-control px-2 py-5 transition-colors hover:bg-surface-soft"><Avatar identity={match.identity} /><span className="min-w-0"><span className="block truncate text-base font-medium">{match.identity.name}</span><span className="mt-2 block text-xs text-muted">继续你们的对话</span></span><ChevronRight aria-hidden="true" size={18} className="ml-auto shrink-0 text-faint" /></MatchLink></li>)}</ul> : !m.conversations.error && <div className="py-10"><MessageCircle aria-hidden="true" className="mb-5 size-9 text-accent" /><p className="text-lg text-ink">你们的故事，从这里开始</p><p className="mt-3 text-sm leading-7 text-muted">和一位朋友打个招呼，之后就能在这里找到你们的聊天。</p><button type="button" className="btn-secondary mt-6" onClick={onDiscover}>认识朋友</button></div>}
  </RecentConversationsFrame>;
}
