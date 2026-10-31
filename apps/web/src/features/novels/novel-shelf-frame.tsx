'use client';

import { MobileNovelShelfFrame, MobileNovelShelfSkeleton } from '@my-platform/mobile-web/novels';
import { useViewport } from '@my-platform/web-ui/use-viewport';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { NovelShelfSearch } from './novel-shelf-controls';

export const novelShelfGridClassName = 'grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:gap-7';

/** The shelf chrome is available before account and query providers resolve. */
export function NovelShelfFrame({ actions, count, search, children }: {
  actions?: ReactNode;
  count?: number;
  search?: ReactNode;
  children: ReactNode;
}) {
  const viewport = useViewport();
  if (viewport === 'mobile') return <MobileNovelShelfFrame actions={actions} count={count} search={search}>{children}</MobileNovelShelfFrame>;
  return <main id="main-content" tabIndex={-1} className="page-shell page-content flex min-h-dvh flex-col md:px-8 xl:px-10">
    <h1 className="sr-only">小说</h1>
    <section aria-labelledby="novel-shelf-heading" className="flex flex-1 flex-col">
      <div className="mb-6 flex min-h-11 items-center justify-between gap-6">
        <div className="flex shrink-0 items-baseline gap-3">
          <h2 id="novel-shelf-heading" className="text-base font-semibold text-ink">书架</h2>
          {count !== undefined && <span className="text-xs tabular-nums text-muted">{count} 本</span>}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-3">{search}{actions && <div className="shrink-0">{actions}</div>}</div>
      </div>
      {children}
    </section>
  </main>;
}

export function NovelShelfCreateAction({ disabled = false }: { disabled?: boolean }) {
  const className = 'btn-primary md:gap-1.5 md:border-line md:bg-panel md:px-3 md:text-sm md:font-medium md:text-ink md:hover:border-control md:hover:bg-surface-soft';
  const label = <><Plus aria-hidden="true" className="hidden size-4 md:block" />创建小说</>;
  return disabled
    ? <button type="button" className={className} disabled>{label}</button>
    : <Link href="/novels/create" className={className}>{label}</Link>;
}

export function NovelShelfLoading() {
  return <NovelShelfFrame actions={<NovelShelfCreateAction disabled />} search={<NovelShelfSearch draft="" onDraftChange={() => {}} onSearch={() => {}} searching={false} busy disabled />}>
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
