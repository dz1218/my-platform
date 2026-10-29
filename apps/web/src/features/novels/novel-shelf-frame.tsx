'use client';

import { MobileNovelShelfFrame, MobileNovelShelfSkeleton } from '@my-platform/mobile-web/novels';
import { useViewport } from '@my-platform/web-ui/use-viewport';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { SceneBanner } from '@/components/scene-banner';
import { PageHeading } from '@/components/page-heading';

export const novelShelfGridClassName = 'grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:gap-7';

/** The shelf chrome is available before account and query providers resolve. */
export function NovelShelfFrame({ actions, count, refreshing = false, onRefresh, children }: {
  actions?: ReactNode;
  count?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const viewport = useViewport();
  if (viewport === 'mobile') return <MobileNovelShelfFrame actions={actions} count={count}>{children}</MobileNovelShelfFrame>;
  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <PageHeading title="小说" description="找一本小说，慢慢读。" actions={actions} />
    <SceneBanner scene="reading" title="翻开一页，走进另一种生活。" description="读几页书，让想象慢下来。下一段故事，从此刻开始。" />
    <div className="section-heading">
      <h2>书架</h2>
      <div className="flex items-center gap-3">
        <span className="text-xs font-normal text-muted">{count === undefined ? '' : `${count} 本小说`}</span>
        <button type="button" aria-label="刷新小说" title="刷新小说" disabled={refreshing || !onRefresh} onClick={onRefresh} className="grid size-11 place-items-center rounded-control text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50">
          <RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
        </button>
      </div>
    </div>
    {children}
  </main>;
}

export function NovelShelfLoading() {
  return <NovelShelfFrame actions={<button type="button" className="btn-primary" disabled>创建小说</button>}>
    <NovelShelfSkeleton />
  </NovelShelfFrame>;
}

export function NovelShelfSkeleton() {
  const viewport = useViewport();
  if (viewport === 'mobile') return <MobileNovelShelfSkeleton />;
  return <SkeletonRegion kind="bookshelf" label="正在加载书架…" className={novelShelfGridClassName}>
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="min-w-0">
      <SkeletonBlock className="aspect-[3/4] rounded-none rounded-r-panel" />
      <SkeletonBlock className="mt-4 h-6 w-3/4" />
      <SkeletonBlock className="mt-2 h-4 w-1/2" />
      <div className="mt-3 space-y-2"><SkeletonBlock className="h-4 w-full" /><SkeletonBlock className="h-4 w-2/3" /></div>
    </div>)}
  </SkeletonRegion>;
}
