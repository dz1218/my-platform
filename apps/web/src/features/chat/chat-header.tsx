'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { MobileChatHeader } from '@my-platform/mobile-web/chat';
import type { ReactNode } from 'react';

export function ChatBack({ intercepted = false, operator = false, onBack, children, ...props }: {
  intercepted?: boolean; operator?: boolean; onBack?: () => void;
  children: ReactNode; className?: string; 'aria-label'?: string;
}) {
  const router = useRouter();
  return onBack || (intercepted && !operator)
    ? <button type="button" {...props} onClick={onBack ?? (() => router.back())}>{children}</button>
    : <Link href={operator ? '/operator' : '/companion'} {...props}>{children}</Link>;
}

export function ChatHeader({ identityName, name = identityName ?? '聊天', operator = false, intercepted = false, onBack, onSettings }: {
  identityName?: string; name?: string; operator?: boolean; intercepted?: boolean;
  onBack?: () => void; onSettings?: () => void;
}) {
  const back = <ChatBack intercepted={intercepted} operator={operator} onBack={onBack}
    aria-label={operator ? '返回我的 AI 身份' : '返回陪伴'}
    className="grid size-11 shrink-0 place-items-center rounded-lg text-2xl text-muted hover:bg-surface-soft hover:text-ink">←</ChatBack>;
  return <>
    <MobileChatHeader back={back} name={name} avatar={identityName?.slice(-1) ?? ''}
      description={operator ? `以${identityName}的身份回复` : ''} canManage={!!onSettings} onSettings={() => onSettings?.()} />
    <header className="hidden items-center gap-2.5 border-b border-line bg-panel px-3.5 py-3 md:flex sm:py-2.5">
      {back}
      <div aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface-soft text-xl text-accent">{identityName?.slice(-1)}</div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold">{name}</h1>
        {operator && <p className="mt-1 text-xs text-muted">以{identityName}的身份回复</p>}
      </div>
      {onSettings && <button type="button" className="chat-settings-trigger" aria-label="会话设置" aria-haspopup="dialog" aria-controls="conversation-settings" onClick={onSettings}><MoreHorizontal size={18} aria-hidden="true" /></button>}
    </header>
  </>;
}
