'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { discover, matches, meet } from '@/services/companion';
import { Avatar } from '@/features/identity/avatar';

export function CompanionHome() {
  const router = useRouter();
  const identities = useQuery({ queryKey: ['discover'], queryFn: discover });
  const conversations = useQuery({ queryKey: ['matches'], queryFn: matches, refetchInterval: 10_000 });
  const mutation = useMutation({ mutationFn: meet, onSuccess: match => router.push(`/chat/${match.id}`) });
  const error = identities.error ?? conversations.error ?? mutation.error;
  return <main className="mx-auto max-w-4xl px-6 pb-20 pt-12 sm:pt-20">
    <p className="mb-4 text-xs tracking-[0.35em] text-rose-200/70">把时间，留给一个人</p>
    <h1 className="font-serif text-4xl text-slate-100 sm:text-5xl">今晚，认识一个人</h1>
    <p className="mt-5 max-w-xl text-sm leading-7 text-slate-400">不急着了解全部。从一句你好开始，让故事慢慢发生。</p>
    {error && <div role="alert" className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-rose-400/10 p-4 text-sm text-rose-200"><span>{error.message}</span><button className="shrink-0 underline" onClick={() => { void identities.refetch(); void conversations.refetch(); mutation.reset(); }}>重试</button></div>}
    {identities.isPending && <p role="status" className="mt-12 text-slate-400">稍等片刻…</p>}
    <section aria-label="可以认识的人" className="mt-12 grid gap-5 sm:grid-cols-3">
      {identities.data?.items.map(identity => {
        const known = conversations.data?.items.find(match => match.identity.id === identity.id);
        return <article key={identity.id} className="glass-card flex flex-col items-center px-6 py-10 text-center">
          <Avatar identity={identity} large />
          <h2 className="mt-7 text-xl font-medium">{identity.name}<span className="ml-3 text-sm font-normal text-slate-500">{identity.age}</span></h2>
          <p className="my-5 font-serif text-sm text-slate-400">“你好。”</p>
          {known ? <Link href={`/chat/${known.id}`} className="btn-glass mt-2">继续聊天</Link> : <button disabled={mutation.isPending} onClick={() => mutation.mutate(identity.id)} className="btn-glass mt-2 disabled:opacity-50">{mutation.isPending && mutation.variables === identity.id ? '稍等…' : '认识她'}</button>}
        </article>;
      })}
    </section>
    {!!conversations.data?.items.length && <section className="mt-14"><h2 className="mb-5 text-sm text-slate-400">你们的故事</h2><div className="grid gap-3">{conversations.data.items.map(match => <Link href={`/chat/${match.id}`} key={match.id} className="glass-card-soft flex items-center gap-4 p-4"><Avatar identity={match.identity} /><span className="flex-1">{match.identity.name}</span><span className="text-xs text-slate-500">继续聊聊 →</span></Link>)}</div></section>}
    <p className="mt-14 text-center text-xs leading-6 text-slate-500">平台中的 AI 身份可能由真实用户参与互动。<Link href="/privacy" className="ml-1 underline underline-offset-4">了解互动方式</Link></p>
  </main>;
}
