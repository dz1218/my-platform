'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { discover, matches, meet } from '@/services/companion';
import { PageHeading } from '@/components/page-heading';
import { Avatar } from '@/features/identity/avatar';

export function CompanionHome() {
  const router = useRouter();
  const identities = useQuery({ queryKey: ['discover'], queryFn: discover });
  const conversations = useQuery({ queryKey: ['matches'], queryFn: matches, refetchInterval: 10_000 });
  const mutation = useMutation({ mutationFn: meet, onSuccess: match => router.push(`/chat/${match.id}`) });
  const error = identities.error ?? conversations.error ?? mutation.error;
  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <PageHeading title="今天想和谁聊聊？" description="认识一位新朋友，或继续上次没聊完的话题。" />
    {error && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error.message}</span><button className="min-h-11 shrink-0 underline" onClick={() => { void identities.refetch(); void conversations.refetch(); mutation.reset(); }}>重试</button></div>}
    <div className="companion-layout">
      <section aria-labelledby="discover-heading" className="min-w-0">
        <div className="section-heading"><h2 id="discover-heading" className="text-base font-semibold">这里的朋友</h2><span className="text-xs font-normal text-muted">{identities.data ? `${identities.data.items.length} 位朋友` : '按自己的节奏来'}</span></div>
        {identities.isPending && <p role="status" className="surface p-8 text-sm text-slate-500">正在寻找可以认识的人…</p>}
        {identities.data?.items.length === 0 && <p className="empty-state">暂时没有新朋友，过会儿再来看看。</p>}
        <div className="person-grid empty:hidden">{identities.data?.items.map(identity => {
          const known = conversations.data?.items.find(match => match.identity.id === identity.id);
          return <article key={identity.id} className="person-card">
            <div className="flex w-full items-center gap-4"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-lg font-semibold">{identity.name}</h3><p className="mt-1 text-sm text-muted">{identity.age} 岁</p></div></div>
            {known ? <Link href={`/chat/${known.id}`} className="btn-secondary w-full">继续聊天<span className="sr-only">，和{identity.name}</span></Link> : <button aria-label={`和${identity.name}打个招呼`} disabled={mutation.isPending || conversations.isPending || !!conversations.error} onClick={() => mutation.mutate(identity.id)} className="btn-primary w-full">{mutation.isPending && mutation.variables === identity.id ? '正在连接…' : '打个招呼'}</button>}
          </article>;
        })}</div>
        <p className="mt-6 max-w-prose text-xs leading-6 text-muted">这里的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 underline underline-offset-4 hover:text-brand-600">了解互动方式</Link></p>
      </section>
      <aside className="conversation-rail" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="section-heading border-b border-line pb-4 text-base">最近聊天<span className="text-xs font-normal tabular-nums text-muted">{conversations.data?.items.length ?? '—'}</span></h2>
        {conversations.isPending ? <p role="status" className="py-4 text-sm text-muted">正在加载聊天…</p> : conversations.data?.items.length ? <ul className="grid gap-2">{conversations.data.items.map(match => <li key={match.id}><Link href={`/chat/${match.id}`} className="flex min-w-0 items-center gap-3 rounded-lg py-3 transition-colors hover:bg-brand-50"><Avatar identity={match.identity} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{match.identity.name}</span><span className="mt-1 block text-xs text-muted">继续你们的对话</span></span><span aria-hidden="true" className="ml-auto text-slate-400">›</span></Link></li>)}</ul> : !conversations.error && <div className="py-6"><p className="text-sm text-ink">你们的故事，从这里开始</p><p className="mt-2 text-xs leading-6 text-muted">和一位朋友打个招呼，之后就能在这里找到你们的聊天。</p><a href="#discover-heading" className="btn-secondary mt-5">认识朋友</a></div>}
        <div className="mt-5 border-t border-line pt-5"><p className="text-xs text-muted">也可以换一种方式放松</p><div className="mt-3 flex gap-4"><Link href="/live" className="link-muted">看看直播</Link><Link href="/novels" className="link-muted">读本小说</Link></div></div>
      </aside>
    </div>
  </main>;
}
