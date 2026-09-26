import type { Message } from '@/types/companion';
import { cn } from '@/lib/cn';

export function MessageBubble({ message }: { message: Message }) {
  const own = message.senderType === 'user';
  return <article className={cn('flex items-start gap-2.5', own && 'flex-row-reverse')}>
    <div aria-hidden="true" className={cn('hidden h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm text-brand-600 sm:grid', own && 'bg-slate-200 text-slate-600')}>
      {own ? '我' : message.sender.name.slice(-1)}
    </div>
    <div className={cn('flex min-w-0 max-w-[82%] flex-col items-start sm:max-w-[min(76%,640px)]', own && 'items-end')}>
      <p className="mx-0.5 mb-1.5 text-xs text-muted">{own ? '我' : message.sender.name}</p>
      <div className={cn('whitespace-pre-wrap break-words rounded-xl rounded-tl-sm border border-line bg-panel px-3.5 py-2.5 text-sm leading-[1.85]', own && 'rounded-tl-xl rounded-tr-sm border-brand-100 bg-brand-50 text-ink')}>
        {message.content}
      </div>
      {own && message.status !== 'complete' && <span className="mt-1.5 text-xs text-muted">{message.status === 'failed' ? '暂未收到回复' : '发送中'}</span>}
    </div>
  </article>;
}
