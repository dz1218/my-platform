'use client';

import { useId, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Eye, MessageCircle, UserRound } from 'lucide-react';
import { InteractionNotice } from './interaction-notice';
import { Sheet } from './sheet';

export function InteractionNoticeDialog({ open, onClose, returnFocusRef }: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  if (!open) return null;
  // Keep the modal outside the account popover and desktop-only navigation.
  return createPortal(
    <NoticeSheet onClose={onClose} returnFocusRef={returnFocusRef} />,
    document.body,
  );
}

function NoticeSheet({ onClose, returnFocusRef }: {
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return <Sheet open onClose={onClose} title="平台互动说明" desktopCentered
    className="notice-dialog md:theme-graphite backdrop:backdrop-blur-sm
      [&>header]:border-0 [&>header]:px-6 [&>header]:pt-5 [&>header]:pb-0 md:[&>header]:px-8 md:[&>header]:pt-6 [&>header>h2]:text-xl
      [&>.sheet-content]:px-6 [&>.sheet-content]:pt-5 [&>.sheet-content]:pb-2 md:[&>.sheet-content]:px-8
      [&>footer]:border-0 [&>footer]:px-6 [&>footer]:pt-5 [&>footer]:pb-[max(24px,env(safe-area-inset-bottom))] md:[&>footer]:px-8 md:[&>footer]:pb-7"
    returnFocusRef={returnFocusRef}
    footer={<div className="flex items-center justify-between gap-4">
      <button type="button" aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}
        className="min-h-11 rounded-control text-sm text-muted transition-colors hover:text-ink">
        {expanded ? '返回要点' : '查看完整说明'}
      </button>
      <button type="button" onClick={onClose} className="btn-secondary shrink-0 px-6">我知道了</button>
    </div>}>
    <div id={contentId}>
      {expanded ? <InteractionNotice /> : <div className="space-y-6 md:space-y-7">
        <div className="flex gap-3.5">
          <MessageCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium leading-6">回复可能来自 AI，也可能来自真人</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">你认识的是虚构角色。角色被用户继承后，可以由继承者回复，也可以由 AI 自动托管。</p>
          </div>
        </div>
        <div className="flex gap-3.5">
          <Eye aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium leading-6">继承者可以查看这个角色的聊天历史</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">包括你与该角色的历史对话。账号与聊天记录会被保存，部分聊天内容会发送给模型服务。请勿发送密码、支付信息等敏感内容。</p>
          </div>
        </div>
        <div className="flex gap-3.5">
          <UserRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium leading-6">是否继承，由你决定</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">每个账户最多继承一个同性别角色，确认后不可更换或转让；原账户仍然保留。</p>
          </div>
        </div>
      </div>}
    </div>
  </Sheet>;
}

export function InteractionNoticeTrigger({ children, ...props }: Omit<ComponentProps<'button'>, 'type' | 'onClick'>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button {...props} ref={trigger} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>{children}</button>
    <InteractionNoticeDialog open={open} onClose={() => setOpen(false)} returnFocusRef={trigger} />
  </>;
}
