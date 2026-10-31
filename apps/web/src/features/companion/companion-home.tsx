'use client';
import Link from 'next/link';
import { MatchLink } from '@/features/chat/match-link';
import { ChevronRight, Users } from 'lucide-react';
import { EmptyState } from '@my-platform/web-ui/empty-state';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuthExit } from '@/features/auth/auth-exit-transition';
import { useAppUI, useBrowseUI } from '@/stores/provider';
import { useBrowseNavigation } from '@/components/browse-navigation';
import { CompanionHeading, CompanionLoadingContent, CompanionCatalogSkeleton, companionPageClassName, companionDesktopLayout, companionRecentRail } from './companion-frame';
import { DiscoveryToolbar } from './discovery-toolbar';
import { RecentConversationsFrame, RecentConversationsSkeleton } from './recent-conversations-frame';
import { useViewport } from '@/components/use-viewport';
import { Avatar } from '@/features/identity/avatar';
import { IdentityModeSwitch } from '@/features/identity/identity-mode-switch';
import { MobileCatalogFilters } from '@/features/catalog/catalog-filters';
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
  if (!viewport) return <main ref={model.pageRef} id={model.paused ? undefined : 'main-content'} tabIndex={-1} className={companionPageClassName}><CompanionLoadingContent /></main>;
  return <main ref={model.pageRef} id={model.paused ? undefined : 'main-content'} tabIndex={-1} className={companionPageClassName}>
    {model.entryLocked && !model.paused && createPortal(<span role="status" className="sr-only">正在进入聊天…</span>, document.body)}
    <MobilePullToRefresh enabled={viewport === 'mobile' && !model.paused && !model.entryLocked} label="人物目录" busy={model.identities.isFetching} onRefresh={() => model.identities.refetch({ throwOnError: true, cancelRefetch: false })} />
    {viewport === 'mobile' ? <MobileCompanionHeading actions={!model.isLoggedIn && <Link href="/login" className="btn-secondary">登录 / 注册</Link>} /> : <CompanionHeading />}
    {inheritedIdentity && <IdentityModeSwitch identity={inheritedIdentity} />}
    {model.error && (viewport === 'mobile' || model.error !== model.conversations.error) && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{model.error.message}</span><button className="min-h-11 shrink-0 hover:text-danger-hover" onClick={model.retry}>重试</button></div>}
    {viewport === 'desktop' ? <DesktopCompanion model={model} /> : <Discovery model={model} mobile />}
  </main>;
}

function DesktopCompanion({ model }: { model: CompanionModel }) {
  return <div className={companionDesktopLayout}><Discovery model={model} /><aside aria-label="最近聊天" className={companionRecentRail}><RecentConversations model={model} /></aside></div>;
}

function Discovery({ model: m, mobile = false }: { model: CompanionModel; mobile?: boolean }) {
  const { restorationPending } = useBrowseNavigation();
  return <section aria-labelledby="discover-heading" className="flex min-w-0 flex-1 flex-col self-stretch">
    <div ref={m.heading} className="relative scroll-mt-8">
      {mobile ? <><h2 id="discover-heading" className="sr-only">这里的朋友</h2><MobileCatalogFilters anchored active={!m.paused} value={m.filters} occupations={m.page?.occupations ?? []} onChange={m.applyFilters} /></> : <DiscoveryToolbar headingId="discover-heading" active={!m.paused} value={m.filters} occupations={m.page?.occupations ?? []} onChange={m.applyFilters} />}
    </div>
    {m.identities.isError && !m.identities.isFetchNextPageError && <div role="alert" className="my-4 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{m.identities.data ? '人物目录更新失败，已保留上次内容。' : '人物目录暂时加载失败。'}{m.identities.error.message}</span><button type="button" disabled={m.identities.isFetching} className="min-h-11 shrink-0 hover:text-danger-hover disabled:opacity-50" onClick={() => void m.identities.refetch()}>重试</button></div>}
    {m.identities.isPending && (mobile ? <MobileCatalogSkeleton /> : <CompanionCatalogSkeleton />)}
    {!m.identities.isPending && !m.identities.error && m.friends.length === 0 && <EmptyState icon={Users} title="没有找到符合条件的朋友" />}
    {/* Each filter result owns its measurements; cached results must not reuse a shorter list's column ranges. */}
    {(m.friends.length > 0 || m.identities.hasNextPage) && <IdentityMasonry key={JSON.stringify(m.filters)} items={m.friends} context={m.cardContext} ItemContent={mobile ? MobileFriendCardAdapter : FriendCard} paused={m.paused} autoLoad={!restorationPending && !m.identities.isRefetchError} mobileColumns={2} gutter={mobile ? 12 : 16} hasNextPage={m.identities.hasNextPage} loading={m.identities.isFetchingNextPage} error={m.identities.isFetchNextPageError ? m.identities.error : null} loadMore={m.loadMore} />}
    {mobile && <p className="mt-6 max-w-prose text-xs leading-6 text-muted">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 text-accent hover:text-ink">了解互动方式</Link></p>}
  </section>;
}

function RecentConversations({ model: m }: { model: CompanionModel }) {
  const setProfileTab = useBrowseUI(s => s.setProfileTab);
  return <RecentConversationsFrame showAll={m.isLoggedIn && Boolean(m.recent?.length)} onViewAll={() => setProfileTab('recent')}>
    {m.conversations.error && <div role="alert" className="px-3 py-3 text-sm leading-6 text-muted"><p>{m.recent?.length ? '聊天列表更新失败，已保留上次内容。' : '聊天列表暂时无法加载。'}</p><button type="button" disabled={m.conversations.isFetching} className="min-h-11 rounded-control text-ink hover:text-muted disabled:opacity-50" onClick={() => void m.conversations.refetch()}>重新加载</button></div>}
    {!m.isLoggedIn ? <div className="px-3 py-5"><p className="text-sm leading-6 text-muted">登录后，在这里继续聊天。</p><Link href="/login" className="btn-secondary mt-4">登录后聊天</Link></div> : m.conversations.isPending ? <RecentConversationsSkeleton /> : m.recent?.length ? <ul className="grid grid-cols-2 gap-x-2 min-[1100px]:grid-cols-1">{m.recent.slice(0, 6).map(match => <li key={match.id}><MatchLink match={match} scroll={false} onClick={m.prepareChat} className="group flex min-w-0 items-center gap-3 rounded-control px-3 py-3 transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft"><Avatar identity={match.identity} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{match.identity.name}</span><span className="mt-1 block truncate text-xs text-muted">{match.identity.occupation || (match.identity.city ? `${match.identity.age} 岁 · ${match.identity.city}` : `${match.identity.age} 岁`)}</span></span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></MatchLink></li>)}</ul> : !m.conversations.error && <p className="px-3 py-5 text-sm leading-6 text-muted">和一位朋友打个招呼，聊天就会出现在这里。</p>}
  </RecentConversationsFrame>;
}
