'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, MoreHorizontal } from 'lucide-react';

/** The conversation owner keeps the connection and draft when this view changes. */
export function MobileChatHeader({ back, name, avatar, description, canManage, onSettings }: {
  back: ReactNode; name: string; avatar: string; description: string;
  canManage: boolean; onSettings: () => void;
}) {
  return <header className="flex min-w-0 items-center gap-3 border-b border-line/60 bg-canvas px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] md:hidden">
    {back}
    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-lg text-accent">{avatar}</span>
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-base font-semibold">{name}</h1>
      {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
    </div>
    {canManage && <button type="button" aria-label="会话设置" aria-haspopup="dialog" aria-controls="conversation-settings" onClick={onSettings} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-soft hover:text-ink"><MoreHorizontal size={20} /></button>}
  </header>;
}

export function MobileMessageComposer({ name, draft, sending, disabled, onChange, onSend }: {
  name: string; draft: string; sending: boolean; disabled: boolean;
  onChange: (value: string) => void; onSend: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [draft]);
  return <form onSubmit={event => { event.preventDefault(); onSend(); }} className="min-w-0">
    <div className="input-group flex items-end gap-2 p-2">
      <label className="min-w-0 flex-1 px-2 py-2">
        <span className="sr-only">给{name}发消息</span>
        <textarea ref={input} name="message" autoComplete="off" rows={1} maxLength={2000} disabled={disabled} value={draft}
          onChange={event => onChange(event.target.value)} placeholder={`和${name}说点什么…`}
          className="block max-h-36 min-h-6 w-full resize-none border-0 bg-transparent text-base leading-6 text-ink outline-none placeholder:text-muted focus-visible:outline-none" />
      </label>
      <button type="submit" aria-label={sending ? '发送中…' : '发送'} disabled={sending || disabled || !draft.trim()}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-action text-on-action transition-colors hover:bg-action-hover disabled:opacity-40">
        <ArrowUp size={21} aria-hidden="true" />
      </button>
    </div>
    <p className="mt-2 px-3 text-xs leading-5 text-muted">{sending ? '发送中…' : '回车换行，点击发送'}</p>
  </form>;
}
