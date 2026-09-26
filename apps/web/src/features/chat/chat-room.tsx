'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMatch } from '@/services/companion';
import { useConversation } from './hooks/use-conversation';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import type { Match } from '@/types/companion';

export function ChatRoom({ matchId }: { matchId: string }) {
  const match = useQuery({ queryKey: ['match', matchId], queryFn: () => getMatch(matchId) });
  if (match.isPending) return <main id="main-content" tabIndex={-1} className="p-12 text-center text-slate-600">正在打开聊天…</main>;
  if (!match.data) return <main id="main-content" tabIndex={-1} className="p-12 text-center"><p role="alert">{match.error?.message ?? '暂时无法打开聊天'}</p><Link href="/companion" className="btn-secondary mt-6">返回陪伴</Link></main>;
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
  useEffect(() => { if (nearBottom.current && !oldestLoading.current) { const el = scroll.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); } }, [newestID, chat.outgoing]);
  async function loadOlder() {
    const el = scroll.current;
    const height = el?.scrollHeight ?? 0;
    oldestLoading.current = true; nearBottom.current = false;
    await chat.loadOlder();
    requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - height; oldestLoading.current = false; });
  }
  return <main id="main-content" tabIndex={-1} className="mx-auto my-0 grid h-[calc(100dvh-61px)] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-bg text-ink sm:my-4 sm:h-[calc(100dvh-93px)] sm:w-[calc(100%-32px)] sm:max-w-[800px] sm:rounded-xl sm:border sm:border-line" aria-label={`和${match.identity.name}的聊天`}>
    <header className="flex items-center gap-2.5 border-b border-line bg-panel px-3.5 py-3 sm:py-2.5">
      <Link href="/companion" aria-label="返回陪伴" className="grid h-10 w-9 place-items-center rounded-lg text-2xl text-muted hover:bg-brand-50 hover:text-ink">←</Link>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-brand-50 text-xl text-brand-600" aria-hidden="true">{match.identity.name.slice(-1)}</div>
      <div><h1 className="text-base font-semibold">{match.identity.name}</h1><p className="mt-1 text-xs text-muted">聊天</p></div>
      <span className="ml-auto hidden text-xs text-muted sm:block">今晚</span>
    </header>
    <div ref={scroll} onScroll={() => { const el = scroll.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} className="min-h-0 overflow-y-auto overscroll-contain px-3.5 py-4 sm:p-5">
      <p className="mb-5 flex items-center justify-center gap-3.5 text-xs text-muted before:h-px before:w-10 before:bg-line before:content-[''] after:h-px after:w-10 after:bg-line after:content-['']">聊天记录</p>
      {chat.hasOlder && <button disabled={chat.loadingOlder} onClick={() => void loadOlder()} className="mx-auto mb-6 block text-xs text-slate-600">{chat.loadingOlder ? '正在加载…' : '查看更早的消息'}</button>}
      {chat.olderError && <p role="alert" className="mb-4 text-center text-sm text-rose-700">{chat.olderError.message}</p>}
      {chat.latest.isPending ? <p className="text-center text-sm text-slate-500">正在打开你们的对话…</p> : !chat.messages.length && <p className="my-12 text-center text-sm text-slate-500">还没有消息，和{match.identity.name}打个招呼吧。</p>}
      {chat.latest.error && <div role="alert" className="mb-5 text-center text-sm text-rose-700">暂时连接不上，正在尝试恢复。<button onClick={() => void chat.latest.refetch()} className="ml-3 underline">重试</button></div>}
      <div role="log" aria-label="聊天记录" className="flex flex-col gap-3.5">
        {chat.messages.map(message => <MessageBubble key={message.id} message={message} />)}
        {chat.outgoing && <MessageBubble message={{ id: chat.outgoing.requestId, content: chat.outgoing.content, senderType: 'user', sender: { id: 'self', name: '我' }, status: 'pending', createdAt: '' }} />}
      </div><div ref={bottom} />
    </div>
    <footer className="border-t border-line bg-panel px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-4">
      {chat.error && <p role="alert" className="mb-3 text-sm text-rose-700">{chat.error.message}</p>}
      {retryable && <button disabled={chat.sending} onClick={() => void chat.send(lastUser.content, lastUser.requestId).catch(() => {})} className="mb-3 text-xs text-rose-700 underline underline-offset-4">上条消息暂未收到回复，重试</button>}
      <MessageComposer matchId={match.id} name={match.identity.name} sending={chat.sending} disabled={chat.latest.isPending} onSend={content => { nearBottom.current = true; return chat.send(content); }} />
    </footer>
  </main>;
}
