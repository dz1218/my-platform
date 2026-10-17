import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LoaderCircle } from 'lucide-react';
import { PageHeading } from './page-heading';

export type LoadingKind = 'chat' | 'operator' | 'room' | 'book' | 'reading' | 'identity' | 'form' | 'page';

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

export function InlineLoading({ label = '正在加载…', className }: { label?: string; className?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className={cn('flex min-h-24 items-center justify-center gap-3 py-6 text-sm text-muted', className)}>
    <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
    <span>{label}</span>
  </div>;
}

const pages: Record<LoadingKind, { title: string; description: string; label: string }> = {
  chat: { title: '聊天', description: '', label: '正在打开聊天…' },
  operator: { title: '回复工作台', description: '以你的 AI 身份回复消息。', label: '正在加载会话…' },
  room: { title: '直播间', description: '', label: '正在连接直播间…' },
  book: { title: '小说', description: '', label: '正在加载小说详情…' },
  reading: { title: '阅读', description: '', label: '正在加载章节…' },
  identity: { title: '选择 AI 身份', description: '找到一个想要了解的角色。', label: '正在加载身份目录…' },
  form: { title: '创作', description: '', label: '正在加载表单…' },
  page: { title: '', description: '', label: '正在加载页面…' },
};

/** Route boundaries keep a real page frame; they never replace the app shell. */
export function PageLoading({ kind = 'page' }: { kind?: LoadingKind }) {
  const page = pages[kind];
  return <main id="main-content" tabIndex={-1} data-page-loading={kind} className={cn(kind === 'reading' ? 'page-reading page-content' : 'page-shell page-content', 'min-h-[60dvh]')}>
    {page.title && <PageHeading title={page.title} description={page.description} />}
    <InlineLoading label={page.label} />
  </main>;
}

export function AuthFormLoading() {
  return <div className="auth-panel"><InlineLoading label="正在加载表单…" /></div>;
}
