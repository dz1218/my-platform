import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';

/** Keep the same panel geometry before account resolution and while chats load. */
export function RecentConversationsFrame({ children, headingId = 'recent-heading', showAll = false, onViewAll }: {
  children: ReactNode;
  headingId?: string;
  showAll?: boolean;
  onViewAll?: () => void;
}) {
  return <section aria-labelledby={headingId}>
    <div className="mb-5 flex min-h-11 items-center justify-between gap-3"><h2 id={headingId} className="text-sm font-semibold">最近聊天</h2>{showAll && <Link href="/me" onClick={onViewAll} className="-mr-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-xs text-muted transition-colors hover:bg-surface-soft hover:text-ink">查看全部<ChevronRight aria-hidden="true" className="size-3.5" /></Link>}</div>
    <div className="rounded-panel bg-panel p-2">{children}</div>
    <Link href="/privacy" className="mt-3 flex min-h-11 items-start gap-2 rounded-control px-2 py-3 text-xs leading-5 text-muted transition-colors hover:bg-surface-soft hover:text-ink">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>AI 身份可能由真实用户参与互动。<span className="mt-1 flex items-center gap-1">了解互动方式<ChevronRight aria-hidden="true" className="size-3" /></span></span>
    </Link>
  </section>;
}

export function RecentConversationsLoading() {
  return <RecentConversationsFrame headingId="recent-loading-heading">
    <RecentConversationsSkeleton />
  </RecentConversationsFrame>;
}

export function RecentConversationsSkeleton() {
  return <SkeletonRegion kind="conversations" label="正在加载聊天…" className="grid grid-cols-2 gap-x-2 min-[1100px]:grid-cols-1">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex min-w-0 items-center gap-3 px-3 py-3"><SkeletonBlock className="size-9 shrink-0 rounded-full" /><div className="min-w-0 flex-1"><SkeletonBlock className="h-5 w-20" /><SkeletonBlock className="mt-1 h-4 w-14" /></div></div>)}
  </SkeletonRegion>;
}
