import { cn } from '@/lib/utils';
import { LoaderCircle } from 'lucide-react';
import { PageHeading } from './page-heading';

export type LoadingKind = 'chat' | 'operator' | 'room' | 'book' | 'reading' | 'identity' | 'form' | 'page';

/** The nearest positioned content region owns the scrim, never the whole app. */
export function LoadingOverlay({ label = '正在加载…', className }: { label?: string; className?: string }) {
  return <div data-loading-overlay role="status" aria-label={label} aria-busy="true" className={cn('pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas/65 p-6 text-sm text-muted', className)}>
    <LoaderCircle aria-hidden="true" className="size-7 shrink-0 text-ink motion-safe:animate-spin" />
    <span>{label}</span>
  </div>;
}

/** Reserve a stable waiting area without inventing cards or hiding page controls. */
export function LoadingPlaceholder({ label, className }: { label?: string; className?: string }) {
  return <div className={cn('relative isolate min-h-48', className)}><LoadingOverlay label={label} /></div>;
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
    <LoadingPlaceholder label={page.label} className="min-h-[40dvh]" />
  </main>;
}

export function AuthFormLoading() {
  return <div className="auth-panel"><LoadingPlaceholder label="正在加载表单…" /></div>;
}
