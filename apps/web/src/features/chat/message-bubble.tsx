import type { Message } from '@/types/companion';
export function MessageBubble({ message }: { message: Message }) {
  const own = message.senderType === 'user';
  return <article className={`flex flex-col ${own ? 'items-end' : 'items-start'}`}>
    <p className="mb-1.5 px-1 text-[11px] text-slate-500">{message.sender.name}</p>
    <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-7 ${own ? 'rounded-tr-sm bg-violet-400/20' : 'rounded-tl-sm border border-white/10 bg-white/5'}`}>{message.content}</div>
    {own && message.status === 'failed' && <span className="mt-1 text-[11px] text-slate-500">暂未收到回复</span>}
  </article>;
}
