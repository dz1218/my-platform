'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { discover, matches, meet } from '@/services/companion';
import { PageHeading } from '@/components/page-heading';
import { Avatar } from '@/features/identity/avatar';

export function CompanionHome() {
  const router = useRouter();
  const [view, setView] = useState<'recent' | 'discover'>('recent');
  const identities = useQuery({ queryKey: ['discover'], queryFn: discover });
  const conversations = useQuery({ queryKey: ['matches'], queryFn: matches, refetchInterval: 10_000 });
  const mutation = useMutation({ mutationFn: meet, onSuccess: match => router.push(`/chat/${match.id}`) });
  const error = identities.error ?? conversations.error ?? mutation.error;
  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <PageHeading title="陪伴" description="今天想和谁聊聊？接着上次的话题，或认识一位新朋友。" />
    {error && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error.message}</span><button className="min-h-11 shrink-0 underline" onClick={() => { void identities.refetch(); void conversations.refetch(); mutation.reset(); }}>重试</button></div>}
    <div className="space-y-5">
      <div className="flex gap-2" aria-label="朋友列表筛选">
        <button aria-pressed={view === 'recent'} onClick={() => setView('recent')} className={view === 'recent' ? 'btn-primary' : 'btn-secondary'}>最近聊天</button>
        <button aria-pressed={view === 'discover'} onClick={() => setView('discover')} className={view === 'discover' ? 'btn-primary' : 'btn-secondary'}>所有朋友</button>
      </div>
      <aside hidden={view !== 'recent'} aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="section-heading">最近聊天<span className="font-normal tabular-nums text-slate-500">{conversations.data?.items.length ?? '—'}</span></h2>
        {conversations.isPending ? <p role="status" className="py-4 text-sm text-slate-500">正在加载聊天…</p> : conversations.data?.items.length ? <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{conversations.data.items.map(match => <li key={match.id}><Link href={`/chat/${match.id}`} className="recent-chat"><Avatar identity={match.identity} large /><span className="min-w-0"><span className="block truncate text-sm font-medium">{match.identity.name}</span><span className="mt-1 block text-xs text-slate-500">{match.identity.age} 岁 · 打开对话</span></span><span aria-hidden="true" className="ml-auto text-slate-400">›</span></Link></li>)}</ul> : !conversations.error && <div className="border-t border-slate-200 py-6"><p className="text-sm text-slate-600">还没有聊过天</p><p className="mt-2 text-xs leading-6 text-slate-500">从打个招呼开始。</p><button className="btn-secondary mt-3" onClick={() => setView('discover')}>认识朋友</button></div>}
      </aside>
      <section hidden={view !== 'discover'} aria-labelledby="discover-heading" className="min-w-0">
        <div className="section-heading"><h2 id="discover-heading" className="text-sm font-semibold">这里的朋友</h2><span className="text-xs text-slate-500">按自己的节奏来</span></div>
        {identities.isPending && <p role="status" className="surface p-8 text-sm text-slate-500">正在寻找可以认识的人…</p>}
        {identities.data?.items.length === 0 && <p className="surface p-8 text-sm text-slate-600">暂时没有新朋友，过会儿再来看看。</p>}
        <div className="person-grid empty:hidden">{identities.data?.items.map(identity => {
          const known = conversations.data?.items.find(match => match.identity.id === identity.id);
          return <article key={identity.id} className="person-card">
            <div className="flex items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-base font-medium">{identity.name}</h3><p className="mt-1 text-sm text-slate-500">{identity.age} 岁</p></div></div>
            {known ? <Link href={`/chat/${known.id}`} className="btn-secondary w-full">聊聊天<span className="sr-only">，和{identity.name}</span></Link> : <button aria-label={`和${identity.name}打个招呼`} disabled={mutation.isPending || conversations.isPending || !!conversations.error} onClick={() => mutation.mutate(identity.id)} className="btn-primary w-full">{mutation.isPending && mutation.variables === identity.id ? '正在连接…' : '打个招呼'}</button>}
          </article>;
        })}</div>
        <p className="mt-5 text-xs leading-6 text-slate-500">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 underline underline-offset-4 hover:text-brand-600">了解互动方式</Link></p>
      </section>
    </div>
  </main>;
}
