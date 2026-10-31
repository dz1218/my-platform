'use client';

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogScrollLock } from '@my-platform/web-ui/dialog-scroll-lock';
import { ChatLoading } from './chat-loading';

/** Immediate visual entry while the server still owns authorization and the URL. */
export function ChatEntryPreview({ identityName, onBack, error, onRetry }: {
  identityName: string; onBack: () => void; error?: string; onRetry?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useDialogScrollLock(dialog);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const shell = document.querySelector('.app-shell');
    if (shell) node.style.setProperty('--chat-nav-width', getComputedStyle(shell).getPropertyValue('--nav-width'));
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(<dialog ref={dialog} aria-label={`和${identityName}的聊天`} onClick={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onBack(); }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-auto max-w-none overflow-hidden border-0 bg-canvas p-0 text-ink backdrop:bg-transparent md:theme-graphite md:left-[var(--chat-nav-width)]">
    <ChatLoading identityName={identityName} onBack={onBack} error={error} onRetry={onRetry} preview />
  </dialog>, document.body);
}
