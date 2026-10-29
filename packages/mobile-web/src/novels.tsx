import type { ReactNode } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
import { SkeletonBlock, SkeletonRegion } from '@my-platform/web-ui/skeleton';

export function MobileNovelShelfFrame({ actions, count, children }: {
  actions?: ReactNode; count?: number; children: ReactNode;
}) {
  return <main id="main-content" tabIndex={-1} data-mobile-page="novels" className="page-shell page-content">
    <h1 className="sr-only">小说</h1>
    <div className="mb-4 flex min-h-11 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-base font-semibold">书架</h2>{count !== undefined && <span className="text-xs text-muted">{count} 本小说</span>}</div>
      {actions && <div className="shrink-0 [&>a]:min-h-11 [&>a]:rounded-full [&>a]:px-4 [&>button]:min-h-11 [&>button]:rounded-full [&>button]:px-4">{actions}</div>}
    </div>
    {children}
  </main>;
}

export function MobileNovelSummary({ title, author, chapterCount, completed, description }: {
  title: string; author: string; chapterCount: number; completed: boolean; description?: string;
}) {
  return <>
    <div aria-hidden="true" className="flex aspect-[3/4] w-24 shrink-0 self-start flex-col justify-between rounded-r-control border-l-4 border-accent-line bg-surface-soft p-3 shadow-panel">
      <BookOpen className="size-4 text-accent" strokeWidth={1.5} />
      <p className="line-clamp-3 text-sm font-medium leading-6 text-ink">{title}</p>
      <span className="truncate text-xs text-muted">{author}</span>
    </div>
    <div className="min-w-0 flex-1 py-1">
      <h2 className="line-clamp-2 text-base font-semibold leading-7 group-hover:text-accent">{title}</h2>
      <p className="mt-1 truncate text-xs text-muted">{author}</p>
      {description && <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{description}</p>}
      <p className="mt-3 flex items-center gap-2 text-xs text-muted"><span>{chapterCount} 章</span><span aria-hidden="true" className="size-0.5 rounded-full bg-muted" /><span>{completed ? '已完结' : '连载中'}</span></p>
    </div>
    <ChevronRight aria-hidden="true" className="size-4 shrink-0 self-center text-muted" />
  </>;
}

export function MobileNovelShelfSkeleton() {
  return <SkeletonRegion kind="bookshelf" label="正在加载书架…" className="divide-y divide-line/60">
    {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex gap-5 py-5 first:pt-0">
      <SkeletonBlock className="aspect-[3/4] w-24 shrink-0 rounded-r-control" />
      <div className="min-w-0 flex-1 py-2"><SkeletonBlock className="h-5 w-4/5" /><SkeletonBlock className="mt-3 h-3 w-16" /><SkeletonBlock className="mt-5 h-3 w-full" /><SkeletonBlock className="mt-3 h-3 w-2/3" /></div>
    </div>)}
  </SkeletonRegion>;
}

export function MobileNovelIntroduction({ cover, children, readAction }: { cover: ReactNode; children: ReactNode; readAction?: ReactNode }) {
  return <div data-mobile-novel-introduction className="mb-8 md:hidden">
    <div className="mx-auto mb-7 w-36">{cover}</div>
    {children}
    {readAction && <div className="mt-6 [&>a]:w-full [&>a]:rounded-full">{readAction}</div>}
  </div>;
}
