'use client';

import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import type { Match } from '@/types/companion';
import { ChatHeader } from './chat-header';
import { MessageComposerView } from './message-composer';
import './chat-room.css';

export function ChatMessagesLoading() {
  return <SkeletonRegion kind="chat-messages" label="正在加载聊天记录…" className="flex flex-col gap-6 py-2">
    <SkeletonBlock className="h-12 w-40 max-w-[65%] rounded-2xl" />
    <SkeletonBlock className="h-16 w-56 max-w-[75%] self-end rounded-2xl" />
    <SkeletonBlock className="h-12 w-48 max-w-[70%] rounded-2xl" />
  </SkeletonRegion>;
}

/** Route, match lookup and click feedback share the final conversation geometry. */
export function ChatLoading({ identityName, intercepted = false, onBack, error, onRetry, preview = false }: {
  identityName?: string; intercepted?: boolean; onBack?: () => void;
  error?: string; onRetry?: () => void; preview?: boolean;
}) {
  return <main id={preview ? undefined : 'main-content'} tabIndex={-1} className="chat-layout" data-chat-loading aria-label={identityName ? `和${identityName}的聊天` : '聊天'}>
    <ChatHeader identityName={identityName} intercepted={intercepted} onBack={onBack} />
    <div className="chat-history min-h-0 overflow-y-auto overscroll-contain px-3.5 py-4">
      <p className="mb-5 flex items-center justify-center gap-3.5 text-xs text-muted before:h-px before:w-10 before:bg-line before:content-[''] after:h-px after:w-10 after:bg-line after:content-['']">聊天记录</p>
      {error ? <div role="alert" className="py-8 text-center text-sm text-muted"><p>{error}</p>{onRetry && <button type="button" onClick={onRetry} className="btn-secondary mt-4">重新加载</button>}</div> : <ChatMessagesLoading />}
    </div>
    <footer className="border-t border-line bg-panel px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-4">
      <MessageComposerView name={identityName ?? '对方'} draft="" disabled onChange={() => {}} onSubmit={() => {}} />
    </footer>
  </main>;
}

export function ChatRouteLoading({ intercepted = false }: { intercepted?: boolean }) {
  const params = useParams<{ matchId: string }>();
  const client = useQueryClient();
  const match = client.getQueryData<Match>(['match', params.matchId]);
  return <ChatLoading identityName={match?.identity.name} intercepted={intercepted} />;
}
