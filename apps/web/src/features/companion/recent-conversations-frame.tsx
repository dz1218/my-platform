import type { ReactNode } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { ConversationSkeleton } from '@/features/chat/conversation-skeleton';

/** Keep the same panel geometry before account resolution and while chats load. */
export function RecentConversationsFrame({ children, mobile = false, headingId = 'recent-heading', count, showRefresh = true, refreshing = false, onRefresh }: {
  children: ReactNode;
  mobile?: boolean;
  headingId?: string;
  count?: number;
  showRefresh?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return <section aria-labelledby={headingId}>
    <h2 id={headingId} className="section-heading min-h-11 pb-3 text-base">
      {mobile ? '接着上次的故事' : '最近聊天'}
      <span className="ml-auto text-xs font-normal text-muted">{count ?? '—'}</span>
      {showRefresh && <button type="button" aria-label="刷新最近聊天" title="刷新最近聊天" disabled={!onRefresh || refreshing} onClick={onRefresh} className="grid size-11 place-items-center rounded-control text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} /></button>}
    </h2>
    {children}
    <div className="mt-6 border-t border-line pt-5"><p className="text-xs text-muted">也可以换一种方式放松</p><div className="mt-3 flex gap-5"><Link href="/live" className="link-muted inline-flex min-h-11 items-center">看看直播</Link><Link href="/novels" className="link-muted inline-flex min-h-11 items-center">读本小说</Link></div></div>
  </section>;
}

export function RecentConversationsLoading({ mobile = false }: { mobile?: boolean }) {
  return <RecentConversationsFrame mobile={mobile} headingId={`recent-loading-${mobile ? 'mobile' : 'desktop'}-heading`} refreshing>
    <ConversationSkeleton />
  </RecentConversationsFrame>;
}
