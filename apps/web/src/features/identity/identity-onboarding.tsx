'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInheritance, inheritanceOptions, inheritIdentity, setInheritanceGender, skipInheritance } from '@/services/inheritance';
import { APIError } from '@/services/api/client';
import { GenderSelect } from '@/features/auth/gender-select';
import type { Gender, Identity, InheritanceState } from '@/types/companion';
import { Avatar } from './avatar';
import { CatalogFilters } from '@/features/catalog/catalog-filters';
import { IdentityMasonry } from '@/features/catalog/identity-masonry';
import { emptyCatalogFilters, type CatalogFilters as Filters } from '@/services/catalog';

type Candidate = Identity & { available: boolean };
type ChoiceContext = { selectedId: string | null; busy: boolean; choose: (identity: Candidate) => void };
function ChoiceCard({ data: identity, index, context }: { data: Candidate; index: number; context: ChoiceContext }) {
  return <div className="p-2"><article data-identity-id={identity.id} data-identity-index={index} className={`surface flex flex-col p-5 ${context.selectedId === identity.id ? 'border-brand-500 ring-1 ring-brand-500' : ''}`}>
    <div className="flex items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0"><h3 className="text-lg font-semibold">{identity.name}</h3><p className="mt-1 text-sm text-muted">{identity.age} 岁{identity.city ? `，${identity.city}` : ''}</p></div></div>
    {identity.occupation && <p className="mt-4 text-sm font-medium text-brand-600">{identity.occupation}</p>}
    {identity.background && <p className="mt-4 text-sm leading-7 text-muted">{identity.background}</p>}
    <div className="mt-auto pt-5"><button type="button" aria-pressed={context.selectedId === identity.id} className="btn-secondary w-full" disabled={!identity.available || context.busy} onClick={() => context.choose(identity)}>{identity.available ? `选择${identity.name}` : `${identity.name}已被继承`}</button></div>
  </article></div>;
}

function inheritanceError(error: Error) {
  if (error instanceof APIError && error.status === 409) return `${error.message} 已为你更新列表。`;
  return error.message;
}

export function IdentityOnboarding({ accountId, accountName }: { accountId: string; accountName: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Candidate | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyCatalogFilters);
  const stateKey = ['identity-inheritance', accountId];
  const state = useQuery({
    queryKey: stateKey,
    queryFn: ({ signal }) => getInheritance(selectedId, signal),
    refetchInterval: query => query.state.error instanceof APIError && query.state.error.status === 404 ? false : 20_000,
  });
  useEffect(() => { if (selectedId) void state.refetch(); }, [selectedId, state.refetch]);
  const optionsKey = ['identity-options', accountId, state.data?.gender, filters];
  const options = useInfiniteQuery({
    queryKey: optionsKey, initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => inheritanceOptions(filters, pageParam, signal),
    getNextPageParam: page => page.nextPage ?? undefined,
    enabled: !!state.data?.gender && !state.data?.identity, staleTime: Infinity,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const [gender, setGender] = useState<Gender | ''>('');
  const review = useRef<HTMLElement | null>(null);
  const success = useRef<HTMLElement | null>(null);
  const claim = useMutation({
    mutationFn: inheritIdentity,
    onSuccess: async ({ identity }) => {
      client.setQueryData<InheritanceState>(stateKey, previous => previous ? { ...previous, identity, onboardingCompleted: true } : previous);
      setSelectedId(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['identity-inheritance'] }),
        client.invalidateQueries({ queryKey: ['identity-options', accountId] }),
        client.invalidateQueries({ queryKey: ['discover'] }),
        client.invalidateQueries({ queryKey: ['matches'] }),
        client.invalidateQueries({ queryKey: ['match'] }),
        client.invalidateQueries({ queryKey: ['auto-reply'] }),
        client.invalidateQueries({ queryKey: ['operator-conversations'] }),
      ]);
      router.refresh();
      requestAnimationFrame(() => success.current?.focus());
    },
    onError: async () => {
      setSelectedId(null);
      await Promise.all([state.refetch(), options.refetch()]);
    },
  });
  const skip = useMutation({
    mutationFn: skipInheritance,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['identity-inheritance'] });
      router.replace('/companion');
      router.refresh();
    },
  });
  const saveGender = useMutation({
    mutationFn: setInheritanceGender,
    onSuccess: async () => { await state.refetch(); router.refresh(); },
  });
  const busy = claim.isPending || skip.isPending || saveGender.isPending;
  const inherited = state.data?.identity;
  const candidates = useMemo(() => [...new Map((options.data?.pages.flatMap(page => page.items) ?? []).filter(item => item.gender === state.data?.gender).map(item => [item.id, item])).values()], [options.data, state.data?.gender]);
  const selected = selectedId ? (state.data?.selectedRequestId === selectedId ? state.data.selected ?? (selectedSnapshot ? { ...selectedSnapshot, available: false } : null) : selectedSnapshot) : null;
  // A response can fail after the server has saved the operation. Only dismiss
  // its error when the current state confirms that operation's result.
  const error = (inherited?.id === claim.variables ? null : claim.error)
    ?? (state.data?.onboardingCompleted ? null : skip.error)
    ?? (state.data?.gender === saveGender.variables ? null : saveGender.error)
    ?? state.error ?? (!options.data ? options.error : null);

  const choose = useCallback((identity: Candidate) => {
    claim.reset();
    skip.reset();
    setSelectedId(identity.id);
    setSelectedSnapshot(identity);
    requestAnimationFrame(() => { review.current?.focus(); review.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); });
  }, [claim.reset, skip.reset]);
  const cardContext = useMemo(() => ({ selectedId, busy, choose }), [selectedId, busy, choose]);
  const loadMore = useCallback(() => { if (!options.isFetching) void options.fetchNextPage(); }, [options.isFetching, options.fetchNextPage]);

  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <div className="mx-auto max-w-[1080px]">
      <header className="page-heading">
        <div>
          <h1 className="page-title">{inherited ? '现在，你有两个身份' : '要继承一个 AI 身份吗？'}</h1>
          <p className="page-description max-w-[640px]">{inherited ? '本账户和 AI 身份各自保留，你可以随时切换聊天方式。' : '继承后，你可以以这个 AI 身份和其他真实用户聊天，也可以用本账户认识其他 AI 朋友。'}</p>
        </div>
      </header>
      {error && <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800">
        <p>{inheritanceError(error)}</p>
        <button type="button" disabled={busy || state.isFetching} className="btn-secondary" onClick={() => { void state.refetch(); if (state.data?.gender && !inherited) void options.refetch(); }}>重新加载</button>
      </div>}
      {state.isPending && <p role="status" className="surface p-8 text-sm text-muted">正在查看可以继承的身份…</p>}
      {state.data && (inherited ? <section ref={success} tabIndex={-1} aria-label="我的两个身份" className="grid gap-5 md:grid-cols-2">
        <section className="content-panel">
          <h2 className="panel-heading">本账户</h2>
          <div className="p-6">
            <p className="text-xl font-semibold">{accountName}</p>
            <p className="mt-3 min-h-12 text-sm leading-6 text-muted">以自己的身份和其他 AI 朋友聊天，你原来的账户与聊天记录继续保留。</p>
            <Link href="/companion" className="btn-secondary mt-6 w-full">以本账户聊天</Link>
          </div>
        </section>
        <section className="content-panel border-brand-300">
          <h2 className="panel-heading">我的 AI 身份</h2>
          <div className="p-6">
            <div className="flex items-center gap-3"><Avatar identity={inherited} /><p className="text-xl font-semibold">{inherited.name}</p></div>
            <p className="mt-3 min-h-12 text-sm leading-6 text-muted">以{inherited.name}的身份回复其他真实用户，并设置 AI 托管、主动联系与虚拟日常。</p>
            <Link href="/operator" className="btn-primary mt-6 w-full">以{inherited.name}的身份回复</Link>
          </div>
        </section>
      </section> : <div className="grid items-start gap-7 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-line pb-6 lg:border-r lg:border-b-0 lg:pr-7" aria-labelledby="own-account-heading">
          <h2 id="own-account-heading" className="text-sm font-semibold text-muted">你的本账户</h2>
          <p className="mt-3 text-xl font-semibold">{accountName}</p>
          <p className="mt-3 text-sm leading-7 text-muted">继承不会替换你的账号。每个 AI 身份只能被继承一次，每个账户只能继承一个。</p>
          <p className="mt-3 text-sm leading-7 text-muted">你只能继承与自己性别相同的 AI 身份。暂不继承也能继续使用，之后可从「我的」回来选择。</p>
          <button type="button" className="btn-secondary mt-5 w-full" disabled={busy} onClick={() => skip.mutate()}>{skip.isPending ? '正在进入…' : '暂不继承，以本账户继续'}</button>
        </aside>
        <section aria-labelledby="available-identities-heading" className="min-w-0">
          {!state.data.gender ? <form className="surface grid max-w-md gap-4 p-5" onSubmit={event => { event.preventDefault(); if (gender) saveGender.mutate(gender); }}>
            <h2 id="available-identities-heading" className="text-lg font-semibold">先补充你的性别</h2>
            <p id="inheritance-gender-help" className="text-sm leading-6 text-muted">我们会展示与你性别相同、可以继承的 AI 身份。</p>
            <div className="grid gap-2 text-sm">
              <label htmlFor="inheritance-gender">性别</label>
              <GenderSelect id="inheritance-gender" describedBy="inheritance-gender-help" value={gender} onChange={setGender} disabled={busy} />
            </div>
            <button type="submit" className="btn-primary" disabled={!gender || busy}>{saveGender.isPending ? '正在保存…' : '保存性别，查看身份'}</button>
          </form> : <>
            <div className="section-heading"><h2 id="available-identities-heading" className="text-base font-semibold">{state.data.gender === 'FEMALE' ? '女性 AI 身份' : '男性 AI 身份'}</h2><span className="text-xs font-normal text-muted">{options.data?.pages[0]?.availableTotal ?? 0} 位可继承</span></div>
            <CatalogFilters value={filters} occupations={options.data?.pages[0]?.occupations ?? []} onChange={next => { void client.cancelQueries({ queryKey: optionsKey }); setFilters(next); document.getElementById('available-identities-heading')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }} />
            {options.isPending && <p role="status" className="surface p-6 text-sm text-muted">正在加载身份…</p>}
            {!options.isPending && !options.error && candidates.length === 0 ? <div className="empty-state text-left">
              <h3 className="text-base font-medium text-ink">{state.data.gender === 'MALE' ? '男性 AI 身份暂未开放' : '暂时没有可继承的女性 AI 身份'}</h3>
              <p className="mt-3">你可以先以本账户和 AI 朋友聊天，之后再回来看看。</p>
            </div> : null}
            <IdentityMasonry items={candidates} context={cardContext} ItemContent={ChoiceCard} autoLoad={!selectedId} hasNextPage={options.hasNextPage} loading={options.isFetchingNextPage} error={options.data ? options.error : null} loadMore={loadMore} />
            {selected && <section ref={review} tabIndex={-1} aria-label={`确认继承${selected.name}`} className="mt-6 rounded-xl border border-brand-300 bg-brand-50 p-5 sm:p-6">
              <h3 className="text-lg font-semibold">确认继承{selected.name}</h3>
              <p className="mt-3 text-sm leading-7">确认后，{selected.name}将成为你唯一的 AI 身份，其他用户不能再继承。继承后不可更换，你的本账户仍然保留。</p>
              <p className="mt-2 text-sm leading-7 text-muted">你可以以{selected.name}的身份回复对话，并管理 AI 托管。和其他 AI 朋友聊天时，使用你的本账户。</p>
              {!selected.available && <p role="status" className="mt-3 text-sm text-rose-700">{selected.name}刚刚被其他用户继承，请重新选择。</p>}
              <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="btn-primary" disabled={busy || !selected.available} onClick={() => claim.mutate(selected.id)}>{claim.isPending ? '正在继承…' : `确认继承${selected.name}`}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => setSelectedId(null)}>重新选择</button></div>
            </section>}
          </>}
        </section>
      </div>)}
    </div>
  </main>;
}
