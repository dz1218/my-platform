'use client';
import Link from 'next/link';
import { ChevronRight, MessageCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PageHeading } from '@/components/page-heading';
import { SceneBanner } from '@/components/scene-banner';
import { useViewport, ViewportSkeleton } from '@/components/use-viewport';
import { Avatar } from '@/features/identity/avatar';
import { IdentityModeSwitch } from '@/features/identity/identity-mode-switch';
import { CatalogFilters, MobileCatalogFilters } from '@/features/catalog/catalog-filters';
import { IdentityMasonry } from '@/features/catalog/identity-masonry';
import { FriendCard } from './friend-card';
import { useCompanionHome, type CompanionModel } from './use-companion-home';
import type { Identity } from '@/types/companion';

type Tab = 'recent' | 'discover';
export function CompanionHome({ accountId, inheritedIdentity }: { accountId: string; inheritedIdentity?: Identity | null }) {
  // The controller is intentionally above both presentations and survives resizing.
  const model = useCompanionHome(accountId, inheritedIdentity);
  const viewport = useViewport();
  const params = useSearchParams();
  const requested = params.get('view');
  const [initialTab, setInitialTab] = useState<Tab | null>(null);
  const lastTab = useRef<Tab>('recent');
  useEffect(() => {
    if (!initialTab && model.conversations.data) setInitialTab(model.recent?.length ? 'recent' : 'discover');
  }, [initialTab, model.conversations.data, model.recent?.length]);
  const selected = requested === 'discover' || requested === 'recent' ? requested : initialTab;
  if (!model.paused && selected) lastTab.current = selected;
  const tab = model.paused ? lastTab.current : selected;
  const chooseTab = (value: Tab) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', value);
    window.history.pushState(null, '', url);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return <main id={model.paused ? undefined : 'main-content'} tabIndex={-1} className="page-shell page-content">
    <PageHeading title={viewport === 'mobile' ? '陪伴' : '今天想和谁聊聊？'} description="认识一位新朋友，或继续上次没聊完的话题。" />
    {inheritedIdentity && <IdentityModeSwitch identity={inheritedIdentity} />}
    {model.error && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger"><span>{model.error.message}</span><button className="min-h-11 shrink-0 underline" onClick={model.retry}>重试</button></div>}
    {!viewport ? <ViewportSkeleton /> : viewport === 'desktop' ? <DesktopCompanion model={model} /> : <MobileCompanion model={model} tab={tab} chooseTab={chooseTab} />}
  </main>;
}

function DesktopCompanion({ model }: { model: CompanionModel }) {
  return <>
    <SceneBanner scene="companion" title="窗外下着雨，心里有回音。" description="从一句问候开始，多一个愿意倾听的朋友。" />
    <div className="companion-layout"><Discovery model={model} /><aside className="conversation-rail"><RecentConversations model={model} onDiscover={() => model.heading.current?.scrollIntoView({ behavior: 'smooth' })} /></aside></div>
  </>;
}

function MobileCompanion({ model, tab, chooseTab }: { model: CompanionModel; tab: Tab | null; chooseTab: (tab: Tab) => void }) {
  return <>
    <nav aria-label="陪伴内容" className="mb-6 flex gap-7 border-b border-line">
      {(['recent', 'discover'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => chooseTab(value)} className={`min-h-12 border-b-2 px-1 pb-3 text-base ${tab === value ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted'}`}>{value === 'recent' ? '最近聊天' : '发现朋友'}</button>)}
    </nav>
    {!tab ? model.conversations.isError ? <p className="empty-state">暂时无法加载聊天，请重试或选择发现朋友。</p> : <ViewportSkeleton /> : tab === 'recent' ? <RecentConversations model={model} onDiscover={() => chooseTab('discover')} mobile /> : <>
      <SceneBanner scene="companion" compact title="从一句问候开始。" description="按自己的节奏，认识一个愿意倾听的人。" />
      <Discovery model={model} mobile />
    </>}
  </>;
}

function Discovery({ model: m, mobile = false }: { model: CompanionModel; mobile?: boolean }) {
  const Filters = mobile ? MobileCatalogFilters : CatalogFilters;
  return <section aria-labelledby="discover-heading" className="min-w-0">
    <div ref={m.heading} className="section-heading"><h2 id="discover-heading" className="text-base font-semibold">这里的朋友</h2><span className="text-xs font-normal text-muted">{m.page ? `${m.page.total} 位朋友` : '按自己的节奏来'}</span></div>
    <Filters value={m.filters} occupations={m.page?.occupations ?? []} onChange={m.applyFilters} />
    {m.identities.isPending && <p role="status" className="surface p-8 text-sm text-muted">正在寻找可以认识的人…</p>}
    {!m.identities.isPending && !m.identities.error && m.friends.length === 0 && <p className="empty-state">没有找到符合条件的朋友，试试其他筛选条件。</p>}
    <IdentityMasonry items={m.friends} context={m.cardContext} ItemContent={FriendCard} paused={m.paused} singleColumn={mobile} hasNextPage={m.identities.hasNextPage} loading={m.identities.isFetchingNextPage} error={m.identities.data ? m.identities.error : null} loadMore={m.loadMore} />
    <p className="mt-6 max-w-prose text-xs leading-6 text-muted">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 underline underline-offset-4 hover:text-accent">了解互动方式</Link></p>
  </section>;
}

function RecentConversations({ model: m, onDiscover, mobile = false }: { model: CompanionModel; onDiscover: () => void; mobile?: boolean }) {
  return <section aria-labelledby="recent-heading">
    <h2 id="recent-heading" className="section-heading pb-3 text-base">{mobile ? '接着上次的故事' : '最近聊天'}<span className="text-xs font-normal text-muted">{m.recent?.length ?? '—'}</span></h2>
    {m.conversations.isPending ? <p role="status" className="py-4 text-sm text-muted">正在加载聊天…</p> : m.recent?.length ? <ul className={mobile ? 'divide-y divide-line/60' : 'grid gap-1'}>{m.recent.map(match => <li key={match.id}><Link href={`/chat/${match.id}`} scroll={false} onClick={m.prepareChat} className="flex min-w-0 items-center gap-4 rounded-control px-2 py-5 transition-colors hover:bg-surface-soft"><Avatar identity={match.identity} large={mobile} /><span className="min-w-0"><span className="block truncate text-base font-medium">{match.identity.name}</span><span className="mt-2 block text-xs text-muted">继续你们的对话</span></span><ChevronRight aria-hidden="true" size={18} className="ml-auto shrink-0 text-faint" /></Link></li>)}</ul> : !m.conversations.error && <div className="py-10"><MessageCircle aria-hidden="true" className="mb-5 size-9 text-accent" /><p className="text-lg text-ink">你们的故事，从这里开始</p><p className="mt-3 text-sm leading-7 text-muted">和一位朋友打个招呼，之后就能在这里找到你们的聊天。</p><button type="button" className="btn-secondary mt-6" onClick={onDiscover}>认识朋友</button></div>}
    <div className="mt-6 border-t border-line pt-5"><p className="text-xs text-muted">也可以换一种方式放松</p><div className="mt-3 flex gap-5"><Link href="/live" className="link-muted inline-flex min-h-11 items-center">看看直播</Link><Link href="/novels" className="link-muted inline-flex min-h-11 items-center">读本小说</Link></div></div>
  </section>;
}
