import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SkeletonKind = 'companion' | 'live' | 'novels' | 'profile' | 'chat' | 'operator' | 'room' | 'book' | 'reading' | 'identity' | 'form' | 'page';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded-control bg-surface-soft motion-safe:animate-pulse', className)} />;
}

export function LoadingRegion({ children, label = '正在加载页面…', className }: { children: ReactNode; label?: string; className?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className={className}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{children}</div>
  </div>;
}

export function ListSkeleton({ books = false, count = 6, label = '正在加载列表…' }: { books?: boolean; count?: number; label?: string }) {
  return <LoadingRegion label={label} className="py-4">
    <div className={books ? 'grid grid-cols-2 gap-5 md:grid-cols-4' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'}>
      {Array.from({ length: count }, (_, i) => <div key={i} className="min-w-0 space-y-4 rounded-panel bg-panel p-5">
        <Skeleton className={books ? 'aspect-[3/4] w-full' : 'size-12 rounded-full'} />
        <Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" />
        {!books && <><Skeleton className="h-3 w-4/5" /><Skeleton className="mt-6 h-11 w-full" /></>}
      </div>)}
    </div>
  </LoadingRegion>;
}

export function skeletonForPath(href: string): SkeletonKind {
  const path = href.split('?')[0];
  if (path.startsWith('/chat/')) return 'chat';
  if (path.startsWith('/operator')) return 'operator';
  if (path.startsWith('/live/')) return 'room';
  if (/\/chapters\/[^/]+$/.test(path)) return 'reading';
  if (path.endsWith('/edit') || path.endsWith('/create')) return 'form';
  if (path.startsWith('/novels/')) return 'book';
  const routes: Partial<Record<string, SkeletonKind>> = { '/companion': 'companion', '/live': 'live', '/novels': 'novels', '/me': 'profile', '/choose-identity': 'identity' };
  return routes[path] ?? 'page';
}

const labels: Record<SkeletonKind, string> = {
  companion: '正在加载陪伴…', live: '正在加载直播大厅…', novels: '正在加载小说…', profile: '正在加载我的主页…',
  chat: '正在打开聊天…', room: '正在加载直播间…', book: '正在加载小说详情…', reading: '正在加载章节…',
  identity: '正在加载身份目录…', operator: '正在加载回复工作台…', form: '正在加载表单…', page: '正在加载页面…',
};

export function PageSkeleton({ kind = 'page' }: { kind?: SkeletonKind }) {
  const immersive = kind === 'chat' || kind === 'room';
  if (kind === 'profile') return <div data-page-skeleton={kind} className="min-h-[70dvh] pb-12">
    <LoadingRegion label={labels[kind]}>
      <div className="relative isolate">
        <Skeleton className="absolute inset-x-0 top-0 -z-10 h-72 rounded-none md:h-80" />
        <div className="page-shell flex min-h-80 items-end gap-5 pb-8 pt-40">
          <Skeleton className="size-20 shrink-0 rounded-full sm:size-24" />
          <div className="space-y-4"><Skeleton className="h-8 w-36" /><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-20" /></div>
        </div>
      </div>
      <div className="page-shell space-y-8"><Skeleton className="h-36 w-full rounded-panel" /><Skeleton className="h-6 w-32" /><SkeletonRows /></div>
    </LoadingRegion>
  </div>;
  return <div data-page-skeleton={kind} className={cn(kind === 'reading' ? 'page-reading page-content' : immersive ? 'p-4 md:p-8' : 'page-shell page-content', 'min-h-[70dvh]')}>
    <LoadingRegion label={labels[kind]}>
      <div className="mb-8 flex items-center gap-4">
        {kind === 'chat' && <Skeleton className="size-14 shrink-0 rounded-full" />}
        <div className="flex-1 space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-3 w-2/3 max-w-80" /></div>
      </div>
      {kind === 'companion' && <Skeleton className="mb-6 h-12 w-full md:hidden" />}
      {['companion', 'live', 'novels'].includes(kind) && <Skeleton className="mb-8 h-36 w-full rounded-panel md:h-64" />}
      {kind === 'chat' ? <div className="flex min-h-[65dvh] flex-col gap-8"><Skeleton className="h-20 w-3/4 max-w-lg" /><Skeleton className="ml-auto h-14 w-1/2 max-w-sm" /><Skeleton className="h-24 w-2/3 max-w-lg" /><Skeleton className="mt-auto h-14 w-full" /></div>
        : kind === 'room' ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"><Skeleton className="aspect-video w-full rounded-panel" /><Skeleton className="h-64 w-full rounded-panel lg:h-full" /></div>
        : kind === 'reading' ? <div className="space-y-5">{Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className={cn('h-4', i % 4 === 3 ? 'w-3/4' : 'w-full')} />)}</div>
        : kind === 'form' ? <div className="max-w-lg space-y-6"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-44 w-full" /></div>
        : kind === 'book' ? <><div className="mb-10 grid gap-7 md:grid-cols-[180px_minmax(0,1fr)]"><Skeleton className="hidden aspect-[3/4] md:block" /><div className="space-y-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-12 w-32" /></div></div><SkeletonRows /></>
        : kind === 'operator' ? <div className="grid gap-8 md:grid-cols-[300px_minmax(0,1fr)]"><SkeletonRows /><Skeleton className="hidden min-h-[60dvh] md:block" /></div>
        : kind === 'companion' ? <div className="companion-layout"><div className="space-y-6"><Skeleton className="h-12 w-full" /><SkeletonCards /></div><div className="hidden space-y-6 md:block"><Skeleton className="h-6 w-32" /><SkeletonRows /></div></div>
        : <>{(kind === 'live' || kind === 'identity') && <Skeleton className="mb-6 h-12 w-full" />}<SkeletonCards books={kind === 'novels'} /></>}
    </LoadingRegion>
  </div>;
}

function SkeletonCards({ books = false }: { books?: boolean }) {
  return <div className={books ? 'grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:gap-7' : 'grid gap-5 md:grid-cols-2 xl:grid-cols-3'}>
    {Array.from({ length: 6 }, (_, i) => <div key={i} className={cn('space-y-4', !books && 'rounded-panel bg-panel p-5')}><Skeleton className={books ? 'aspect-[3/4]' : 'h-16'} /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}
  </div>;
}

function SkeletonRows() {
  return <div className="space-y-6">{Array.from({ length: 4 }, (_, i) => <div key={i} className="flex items-center gap-4"><Skeleton className="size-12 shrink-0 rounded-full" /><div className="flex-1 space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div></div>)}</div>;
}

export function AuthFormSkeleton() {
  return <div className="auth-panel"><LoadingRegion label="正在加载表单…"><div className="space-y-6 py-6"><Skeleton className="h-8 w-32" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div></LoadingRegion></div>;
}

export function AppStartupSkeleton() {
  return <div className="min-h-dvh bg-canvas text-ink"><PageSkeleton /></div>;
}
