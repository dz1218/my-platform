'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMatch } from '@/services/companion';
import { Avatar } from '@/features/identity/avatar';
import { useConversation } from './hooks/use-conversation';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import type { Match } from '@/types/companion';

export function ChatRoom({ matchId }: { matchId: string }) {
  const match = useQuery({ queryKey: ['match', matchId], queryFn: () => getMatch(matchId) });
  if (match.isPending) return <main className="p-12 text-center text-slate-400">正在打开聊天…</main>;
  if (!match.data) return <main className="p-12 text-center"><p role="alert">{match.error?.message ?? '暂时无法打开聊天'}</p><Link href="/companion" className="btn-glass mt-6">返回陪伴</Link></main>;
  return <Conversation key={match.data.conversationId} match={match.data} />;
}
function Conversation({ match }: { match: Match }) {
  const chat = useConversation(match.conversationId);
  const bottom = useRef<HTMLDivElement | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const oldestLoading = useRef(false);
  const lastUser = [...chat.messages].reverse().find(message => message.senderType === 'user');
  const retryable = lastUser?.status === 'failed' && lastUser.requestId;
  const newestID = chat.messages.at(-1)?.id;
  useEffect(() => { if (nearBottom.current && !oldestLoading.current) bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [newestID, chat.outgoing]);
  async function loadOlder() {
    const el = scroll.current;
    const height = el?.scrollHeight ?? 0;
    oldestLoading.current = true; nearBottom.current = false;
    await chat.loadOlder();
    requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - height; oldestLoading.current = false; });
  }
  return <main className="mx-auto flex h-[calc(100dvh-73px)] max-w-3xl flex-col">
    <header className="flex items-center gap-4 border-b border-white/10 px-5 py-4"><Link href="/companion" aria-label="返回陪伴" className="pr-2 text-slate-400">←</Link><Avatar identity={match.identity} /><h1 className="text-lg">{match.identity.name}</h1></header>
    <div ref={scroll} onScroll={() => { const el = scroll.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} className="flex-1 overflow-y-auto px-5 py-6">
      {chat.hasOlder && <button disabled={chat.loadingOlder} onClick={() => void loadOlder()} className="mx-auto mb-6 block text-xs text-slate-400">{chat.loadingOlder ? '正在加载…' : '查看更早的消息'}</button>}
      {chat.olderError && <p role="alert" className="mb-4 text-center text-sm text-rose-300">{chat.olderError.message}</p>}
      {chat.latest.isPending ? <p className="text-center text-sm text-slate-500">正在打开你们的对话…</p> : !chat.messages.length && <p className="my-12 text-center text-sm text-slate-500">你和{match.identity.name}的故事，从这里开始。</p>}
      {chat.latest.error && <div role="alert" className="mb-5 text-center text-sm text-rose-300">暂时连接不上，正在尝试恢复。<button onClick={() => void chat.latest.refetch()} className="ml-3 underline">重试</button></div>}
      <div role="log" aria-label="聊天记录" className="space-y-5">
        {chat.messages.map(message => <MessageBubble key={message.id} message={message} />)}
        {chat.outgoing && <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-violet-400/20 px-4 py-3 text-sm leading-7">{chat.outgoing.content}<span className="ml-3 text-xs text-slate-500">发送中</span></div>}
      </div><div ref={bottom} />
    </div>
    <footer className="border-t border-white/10 bg-slate-950/50 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
      {chat.error && <p role="alert" className="mb-3 text-sm text-rose-300">{chat.error.message}</p>}
      {retryable && <button disabled={chat.sending} onClick={() => void chat.send(lastUser.content, lastUser.requestId).catch(() => {})} className="mb-3 text-xs text-rose-200 underline underline-offset-4">上条消息暂未收到回复，重试</button>}
      <MessageComposer matchId={match.id} name={match.identity.name} sending={chat.sending} disabled={chat.latest.isPending} onSend={content => { nearBottom.current = true; return chat.send(content); }} />
    </footer>
  </main>;
}
