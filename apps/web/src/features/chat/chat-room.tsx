'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMatch } from '@/services/companion';
import { history, streamMessage } from '@/services/chat';
import { useChatUI } from '@/stores/chat';
import { Avatar } from '@/features/identity/avatar';
import type { Message } from '@/types/companion';

export function ChatRoom({ matchId }: { matchId: string }) {
  const queryClient = useQueryClient();
  const match = useQuery({ queryKey: ['match', matchId], queryFn: () => getMatch(matchId) });
  const conversationId = match.data?.conversationId ?? '';
  const messages = useInfiniteQuery({
    queryKey: ['messages', conversationId], enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => history(conversationId, pageParam),
    getNextPageParam: page => page.nextCursor,
  });
  const draft = useChatUI(state => state.drafts[matchId] ?? '');
  const stream = useChatUI(state => state.streaming[matchId] ?? '');
  const { setDraft, setStream } = useChatUI();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [outgoing, setOutgoing] = useState<{ content: string; requestId: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const all = [...(messages.data?.pages ?? [])].reverse().flatMap(page => page.items);
  const lastUser = [...all].reverse().find(message => message.senderType === 'user');
  const retryable = !sending && lastUser && lastUser.status !== 'complete' && lastUser.requestId;
  const pendingVisible = outgoing && !all.some(message => message.requestId === outgoing.requestId);

  useEffect(() => () => { controller.current?.abort(); setStream(matchId, ''); }, [matchId, setStream]);
  useEffect(() => { if (nearBottom.current) bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [all.length, stream, outgoing]);

  async function send(retry?: { content: string; requestId: string }) {
    if (controller.current || !conversationId) return;
    const content = retry?.content ?? draft.trim();
    if (!content) return;
    const turn = retry ?? { content, requestId: crypto.randomUUID() };
    const abort = new AbortController(); controller.current = abort;
    setSending(true); setError(''); setStream(matchId, ''); setOutgoing(turn); nearBottom.current = true;
    if (!retry) setDraft(matchId, '');
    let accepted = false, partial = '';
    try {
      await streamMessage(conversationId, content, turn.requestId, abort.signal, event => {
        if (event.event === 'accepted') { accepted = true; void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] }); }
        if (event.event === 'delta') { partial += event.data.content; setStream(matchId, partial); }
      });
      setOutgoing(null);
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '消息没有发送成功');
        if (!accepted && !retry) setDraft(matchId, content);
      }
      setOutgoing(null);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['matches'] });
      setStream(matchId, ''); setSending(false); controller.current = null;
    }
  }
  if (match.isPending) return <main className="p-12 text-center text-slate-400">正在打开聊天…</main>;
  if (!match.data) return <main className="p-12 text-center"><p role="alert">{match.error?.message ?? '暂时无法打开聊天'}</p><Link href="/companion" className="btn-glass mt-6">返回陪伴</Link></main>;
  const identity = match.data.identity;
  return <main className="mx-auto flex h-[calc(100dvh-73px)] max-w-3xl flex-col">
    <header className="flex items-center gap-4 border-b border-white/10 px-5 py-4">
      <Link href="/companion" aria-label="返回陪伴" className="pr-2 text-slate-400">←</Link><Avatar identity={identity} /><h1 className="text-lg">{identity.name}</h1>
    </header>
    <div ref={scroll} onScroll={() => { const el = scroll.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} className="flex-1 overflow-y-auto px-5 py-6">
      {messages.hasNextPage && <button disabled={messages.isFetchingNextPage} onClick={() => { nearBottom.current = false; void messages.fetchNextPage(); }} className="mx-auto mb-6 block text-xs text-slate-400">{messages.isFetchingNextPage ? '正在加载…' : '查看更早的消息'}</button>}
      {messages.isPending ? <p className="text-center text-sm text-slate-500">正在打开你们的对话…</p> : all.length === 0 && <p className="my-12 text-center text-sm text-slate-500">你和{identity.name}的故事，从这里开始。</p>}
      {messages.error && <div role="alert" className="mb-5 text-center text-sm text-rose-300">{messages.error.message}<button onClick={() => void messages.refetch()} className="ml-3 underline">重试</button></div>}
      <div role="log" aria-label="聊天记录" className="space-y-5">
        {all.map(message => <Bubble key={message.id} message={message} />)}
        {pendingVisible && <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-violet-400/20 px-4 py-3 text-sm leading-7">{outgoing.content}</div>}
        {stream && <div aria-label={`${identity.name}的回复`} className="mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-4 py-3 text-sm leading-7">{stream}</div>}
      </div>
      <div ref={bottom} />
    </div>
    <footer className="border-t border-white/10 bg-slate-950/50 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
      {error && <p role="alert" className="mb-3 text-sm text-rose-300">{error}</p>}
      {retryable && <button onClick={() => void send({ content: lastUser.content, requestId: lastUser.requestId! })} className="mb-3 text-xs text-rose-200 underline underline-offset-4">上条消息尚未收到回复，重试</button>}
      <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex items-end gap-3">
        <label className="min-w-0 flex-1"><span className="sr-only">给{identity.name}发消息</span><textarea rows={2} maxLength={2000} value={draft} onChange={event => setDraft(matchId, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="想说些什么…" className="input-glass resize-none" /></label>
        <button type="submit" disabled={sending || !draft.trim() || messages.isPending || !!messages.error} className="btn-indigo mb-0.5">{sending ? '发送中…' : '发送'}</button>
      </form>
    </footer>
  </main>;
}
function Bubble({ message }: { message: Message }) {
  const own = message.senderType === 'user';
  return <article className={`flex flex-col ${own ? 'items-end' : 'items-start'}`}>
    <p className="mb-1.5 px-1 text-[11px] text-slate-500">{message.sender.name}</p>
    <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-7 ${own ? 'rounded-tr-sm bg-violet-400/20' : 'rounded-tl-sm border border-white/10 bg-white/5'}`}>{message.content}</div>
  </article>;
}
