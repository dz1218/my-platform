'use client';
import Link from 'next/link';
import { MatchLink } from '@/features/chat/match-link';
import { InlineLoading, ListSkeleton } from '@/components/page-skeleton';
import { ChevronRight, MessageCircle, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAuthExit } from '@/features/auth/auth-exit-transition';
import { useAppUI } from '@/stores/provider';
import { useBrowseNavigation } from '@/components/browse-navigation';
import { PageHeading } from '@/components/page-heading';
import { SceneBanner } from '@/components/scene-banner';
import { useViewport, ViewportLoading } from '@/components/use-viewport';
import { Avatar } from '@/features/identity/avatar';
import { IdentityModeSwitch } from '@/features/identity/identity-mode-switch';
import { CatalogFilters, MobileCatalogFilters } from '@/features/catalog/catalog-filters';
import { IdentityMasonry } from '@/features/catalog/identity-masonry';
import { FriendCard } from './friend-card';
import { useCompanionHome, type CompanionModel } from './use-companion-home';
import type { Identity } from '@/types/companion';

type Tab = 'recent' | 'discover';
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
  const { prepareNavigation } = useBrowseNavigation();
  const params = useSearchParams();
  const requested = params.get('view');
  const { initialTab, initializeTab } = model;
  const lastTab = useRef<Tab>('recent');
  useEffect(() => {
    if (!initialTab && model.conversations.data) initializeTab(model.recent?.length ?? 0);
  }, [initialTab, model.conversations.data, model.recent?.length, initializeTab]);
  const selected = requested === 'discover' || requested === 'recent' ? requested : model.isLoggedIn ? initialTab : 'discover';
  if (!model.paused && selected) lastTab.current = selected;
  const tab = model.paused ? lastTab.current : selected;
  const chooseTab = (value: Tab) => {
    if (value === tab) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', value);
    prepareNavigation(url.pathname + url.search);
    window.history.pushState(null, '', url);
  };
  return <main id={model.paused ? undefined : 'main-content'} tabIndex={-1} className="page-shell page-content">
    <PageHeading title={viewport === 'mobile' ? '陪伴' : '今天想和谁聊聊？'} description="认识一位新朋友，或继续上次没聊完的话题。" actions={!model.isLoggedIn && viewport === 'mobile' && <Link href="/login" className="btn-secondary">登录 / 注册</Link>} />
    {inheritedIdentity && <IdentityModeSwitch identity={inheritedIdentity} />}
    {model.error && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{model.error.message}</span><button className="min-h-11 shrink-0 hover:text-danger-hover" onClick={model.retry}>重试</button></div>}
    {!viewport ? <ViewportLoading /> : viewport === 'desktop' ? <DesktopCompanion model={model} /> : <MobileCompanion model={model} tab={tab} chooseTab={chooseTab} />}
  </main>;
}

function DesktopCompanion({ model }: { model: CompanionModel }) {
  return <>
    <SceneBanner scene="companion" title="窗外下着雨，心里有回音。" description="从一句问候开始，多一个愿意倾听的朋友。" />
    <div className="companion-layout"><Discovery model={model} /><aside aria-label="最近聊天" className="conversation-rail"><RecentConversations model={model} onDiscover={() => model.heading.current?.scrollIntoView({ behavior: 'smooth' })} /></aside></div>
  </>;
}

function MobileCompanion({ model, tab, chooseTab }: { model: CompanionModel; tab: Tab | null; chooseTab: (tab: Tab) => void }) {
  return <>
    <nav aria-label="陪伴内容" className="mb-6 flex gap-7 border-b border-line">
      {(['recent', 'discover'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => chooseTab(value)} className={`min-h-12 border-b-2 px-1 pb-3 text-base ${tab === value ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted'}`}>{value === 'recent' ? '最近聊天' : '发现朋友'}</button>)}
    </nav>
    {!tab ? model.conversations.isError ? <p className="empty-state">暂时无法加载聊天，请重试或选择发现朋友。</p> : <ViewportLoading /> : tab === 'recent' ? <RecentConversations model={model} onDiscover={() => chooseTab('discover')} mobile /> : <>
      <SceneBanner scene="companion" compact title="从一句问候开始。" description="按自己的节奏，认识一个愿意倾听的人。" />
      <Discovery model={model} mobile />
    </>}
  </>;
}

function Discovery({ model: m, mobile = false }: { model: CompanionModel; mobile?: boolean }) {
  const { restorationPending } = useBrowseNavigation();
  const Filters = mobile ? MobileCatalogFilters : CatalogFilters;
  return <section aria-labelledby="discover-heading" className="min-w-0">
    <div ref={m.heading} className="section-heading"><h2 id="discover-heading" className="text-base font-semibold">这里的朋友</h2><div className="flex items-center gap-3"><span className="text-xs font-normal text-muted">{m.page ? `${m.page.total} 位朋友` : '按自己的节奏来'}</span><button type="button" aria-label="刷新人物目录" title="刷新人物目录" disabled={m.identities.isFetching} onClick={() => void m.identities.refetch()} className="grid size-11 place-items-center rounded-control text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${m.identities.isFetching ? 'motion-safe:animate-spin' : ''}`} /></button></div></div>
    <Filters value={m.filters} occupations={m.page?.occupations ?? []} onChange={m.applyFilters} />
    {m.identities.isError && !m.identities.isFetchNextPageError && <div role="alert" className="my-4 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{m.identities.data ? '人物目录更新失败，已保留上次内容。' : '人物目录暂时加载失败。'}{m.identities.error.message}</span><button type="button" disabled={m.identities.isFetching} className="min-h-11 shrink-0 hover:text-danger-hover disabled:opacity-50" onClick={() => void m.identities.refetch()}>重试</button></div>}
    {m.identities.isPending && <ListSkeleton label="正在寻找可以认识的人…" />}
    {!m.identities.isPending && !m.identities.error && m.friends.length === 0 && <p className="empty-state">没有找到符合条件的朋友，试试其他筛选条件。</p>}
    <IdentityMasonry items={m.friends} context={m.cardContext} ItemContent={FriendCard} paused={m.paused} autoLoad={!restorationPending && !m.identities.isRefetchError} singleColumn={mobile} hasNextPage={m.identities.hasNextPage} loading={m.identities.isFetchingNextPage} error={m.identities.isFetchNextPageError ? m.identities.error : null} loadMore={m.loadMore} />
    <p className="mt-6 max-w-prose text-xs leading-6 text-muted">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 text-accent hover:text-ink">了解互动方式</Link></p>
  </section>;
}

function RecentConversations({ model: m, onDiscover, mobile = false }: { model: CompanionModel; onDiscover: () => void; mobile?: boolean }) {
  return <section aria-labelledby="recent-heading">
    <h2 id="recent-heading" className="section-heading pb-3 text-base">{mobile ? '接着上次的故事' : '最近聊天'}<span className="ml-auto text-xs font-normal text-muted">{m.recent?.length ?? '—'}</span>{m.isLoggedIn && <button type="button" aria-label="刷新最近聊天" title="刷新最近聊天" disabled={m.conversations.isFetching} onClick={() => void m.conversations.refetch()} className="grid size-11 place-items-center rounded-control text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${m.conversations.isFetching ? 'motion-safe:animate-spin' : ''}`} /></button>}</h2>
    {!m.isLoggedIn ? <div className="py-10"><MessageCircle aria-hidden="true" className="mb-5 size-9 text-accent" /><p className="text-lg text-ink">先认识一位朋友</p><p className="mt-3 text-sm leading-7 text-muted">登录后开始聊天，在这里继续你们的故事。</p><Link href="/login" className="btn-secondary mt-6">登录后聊天</Link></div> : m.conversations.isPending ? <InlineLoading label="正在加载聊天…" /> : m.recent?.length ? <ul className={mobile ? 'divide-y divide-line/60' : 'grid gap-1'}>{m.recent.map(match => <li key={match.id}><MatchLink match={match} scroll={false} onClick={m.prepareChat} className="flex min-w-0 items-center gap-4 rounded-control px-2 py-5 transition-colors hover:bg-surface-soft"><Avatar identity={match.identity} large={mobile} /><span className="min-w-0"><span className="block truncate text-base font-medium">{match.identity.name}</span><span className="mt-2 block text-xs text-muted">继续你们的对话</span></span><ChevronRight aria-hidden="true" size={18} className="ml-auto shrink-0 text-faint" /></MatchLink></li>)}</ul> : !m.conversations.error && <div className="py-10"><MessageCircle aria-hidden="true" className="mb-5 size-9 text-accent" /><p className="text-lg text-ink">你们的故事，从这里开始</p><p className="mt-3 text-sm leading-7 text-muted">和一位朋友打个招呼，之后就能在这里找到你们的聊天。</p><button type="button" className="btn-secondary mt-6" onClick={onDiscover}>认识朋友</button></div>}
    <div className="mt-6 border-t border-line pt-5"><p className="text-xs text-muted">也可以换一种方式放松</p><div className="mt-3 flex gap-5"><Link href="/live" className="link-muted inline-flex min-h-11 items-center">看看直播</Link><Link href="/novels" className="link-muted inline-flex min-h-11 items-center">读本小说</Link></div></div>
  </section>;
}
