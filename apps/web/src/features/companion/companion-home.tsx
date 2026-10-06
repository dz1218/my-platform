'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { discover, matches, meet } from '@/services/companion';
import { emptyCatalogFilters, type CatalogFilters as Filters } from '@/services/catalog';
import { PageHeading } from '@/components/page-heading';
import { Avatar } from '@/features/identity/avatar';
import { IdentityModeSwitch } from '@/features/identity/identity-mode-switch';
import { CatalogFilters } from '@/features/catalog/catalog-filters';
import { IdentityMasonry } from '@/features/catalog/identity-masonry';
import { useCompanionNavigation } from './companion-navigation';
import type { Identity, Match } from '@/types/companion';

type CardContext = { known: Map<string, Match>; busy: boolean; pendingId?: string; meet: (id: string) => void; prepareChat: () => void };
function FriendCard({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  const known = context.known.get(identity.id);
  return <div className="p-2"><article data-identity-id={identity.id} data-identity-index={index} className="person-card !gap-5">
    <div className="flex w-full items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-lg font-semibold">{identity.name}</h3><p className="mt-1 text-sm text-muted">{identity.age} 岁{identity.city ? `，${identity.city}` : ''}</p></div></div>
    {identity.occupation && <p className="text-sm font-medium text-brand-600">{identity.occupation}</p>}
    {identity.background && <p className="text-sm leading-7 text-muted">{identity.background}</p>}
    {known ? <Link href={`/chat/${known.id}`} scroll={false} onClick={context.prepareChat} className="btn-secondary w-full">继续聊天<span className="sr-only">，和{identity.name}</span></Link> : <button aria-label={`和${identity.name}打个招呼`} disabled={context.busy} onClick={() => context.meet(identity.id)} className="btn-primary w-full">{context.pendingId === identity.id ? '正在连接…' : '打个招呼'}</button>}
  </article></div>;
}

export function CompanionHome({ accountId, inheritedIdentity }: { accountId: string; inheritedIdentity?: Identity | null }) {
  const router = useRouter();
  const client = useQueryClient();
  const { paused, prepareChat } = useCompanionNavigation();
  const [filters, setFilters] = useState<Filters>(emptyCatalogFilters);
  const heading = useRef<HTMLDivElement>(null);
  const catalogKey = useMemo(() => ['discover', accountId, filters], [accountId, filters]);
  const identities = useInfiniteQuery({
    queryKey: catalogKey, initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => discover(filters, pageParam, signal),
    getNextPageParam: page => page.nextPage ?? undefined,
    enabled: !paused, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const conversations = useQuery({ queryKey: ['matches', accountId], queryFn: matches, enabled: !paused, refetchInterval: paused ? false : 10_000 });
  useEffect(() => {
    if (paused) { void client.cancelQueries({ queryKey: catalogKey }); void client.cancelQueries({ queryKey: ['matches', accountId] }); }
  }, [paused, client, catalogKey, accountId]);
  const mutation = useMutation({ mutationFn: meet, onSuccess: match => {
    client.setQueryData<Match>(['match', match.id], match);
    client.setQueryData<{ items: Match[] }>(['matches', accountId], previous => ({ items: [match, ...(previous?.items.filter(item => item.id !== match.id) ?? [])] }));
    prepareChat();
    router.push(`/chat/${match.id}`, { scroll: false });
  } });
  const friends = useMemo(() => [...new Map((identities.data?.pages.flatMap(page => page.items) ?? []).filter(identity => identity.id !== inheritedIdentity?.id).map(identity => [identity.id, identity])).values()], [identities.data, inheritedIdentity?.id]);
  const recent = conversations.data?.items.filter(match => match.identity.id !== inheritedIdentity?.id);
  const known = useMemo(() => new Map(conversations.data?.items.map(match => [match.identity.id, match])), [conversations.data]);
  const meetIdentity = useCallback((id: string) => mutation.mutate(id), [mutation.mutate]);
  const cardContext = useMemo<CardContext>(() => ({ known, busy: mutation.isPending || conversations.isPending || !!conversations.error, pendingId: mutation.isPending ? mutation.variables : undefined, meet: meetIdentity, prepareChat }), [known, mutation.isPending, mutation.variables, conversations.isPending, conversations.error, meetIdentity, prepareChat]);
  const loadMore = useCallback(() => { if (!paused && !identities.isFetching) void identities.fetchNextPage(); }, [paused, identities.isFetching, identities.fetchNextPage]);
  const error = (!identities.data ? identities.error : null) ?? conversations.error ?? mutation.error;
  const page = identities.data?.pages[0];
  return <main id={paused ? undefined : 'main-content'} tabIndex={-1} className="page-shell page-content">
    <PageHeading title="今天想和谁聊聊？" description="认识一位新朋友，或继续上次没聊完的话题。" />
    {inheritedIdentity && <IdentityModeSwitch identity={inheritedIdentity} />}
    {error && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error.message}</span><button className="min-h-11 shrink-0 underline" onClick={() => { void identities.refetch(); void conversations.refetch(); mutation.reset(); }}>重试</button></div>}
    <div className="companion-layout">
      <section aria-labelledby="discover-heading" className="min-w-0">
        <div ref={heading} className="section-heading"><h2 id="discover-heading" className="text-base font-semibold">这里的朋友</h2><span className="text-xs font-normal text-muted">{page ? `${page.total} 位朋友` : '按自己的节奏来'}</span></div>
        <CatalogFilters value={filters} occupations={page?.occupations ?? []} onChange={next => {
          void client.cancelQueries({ queryKey: catalogKey });
          setFilters(next);
          heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
        }} />
        {identities.isPending && <p role="status" className="surface p-8 text-sm text-muted">正在寻找可以认识的人…</p>}
        {!identities.isPending && !identities.error && friends.length === 0 && <p className="empty-state">没有找到符合条件的朋友，试试其他筛选条件。</p>}
        <IdentityMasonry items={friends} context={cardContext} ItemContent={FriendCard} paused={paused} hasNextPage={identities.hasNextPage} loading={identities.isFetchingNextPage} error={identities.data ? identities.error : null} loadMore={loadMore} />
        <p className="mt-6 max-w-prose text-xs leading-6 text-muted">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 underline underline-offset-4 hover:text-brand-600">了解互动方式</Link></p>
      </section>
      <aside className="conversation-rail" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="section-heading border-b border-line pb-4 text-base">最近聊天<span className="text-xs font-normal tabular-nums text-muted">{recent?.length ?? '—'}</span></h2>
        {conversations.isPending ? <p role="status" className="py-4 text-sm text-muted">正在加载聊天…</p> : recent?.length ? <ul className="grid gap-2">{recent.map(match => <li key={match.id}><Link href={`/chat/${match.id}`} scroll={false} onClick={prepareChat} className="flex min-w-0 items-center gap-3 rounded-lg py-3 transition-colors hover:bg-brand-50"><Avatar identity={match.identity} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{match.identity.name}</span><span className="mt-1 block text-xs text-muted">继续你们的对话</span></span><span aria-hidden="true" className="ml-auto text-slate-400">›</span></Link></li>)}</ul> : !conversations.error && <div className="py-6"><p className="text-sm text-ink">你们的故事，从这里开始</p><p className="mt-2 text-xs leading-6 text-muted">和一位朋友打个招呼，之后就能在这里找到你们的聊天。</p><a href="#discover-heading" className="btn-secondary mt-5">认识朋友</a></div>}
        <div className="mt-5 border-t border-line pt-5"><p className="text-xs text-muted">也可以换一种方式放松</p><div className="mt-3 flex gap-4"><Link href="/live" className="link-muted">看看直播</Link><Link href="/novels" className="link-muted">读本小说</Link></div></div>
      </aside>
    </div>
  </main>;
}
