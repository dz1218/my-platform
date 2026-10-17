import type { ReactNode } from 'react';

/** Server-renderable slots preserve the chapter's native links and SSR content. */
export function MobileReadingNavigation({ previous, contents, next }: { previous?: ReactNode; contents: ReactNode; next?: ReactNode }) {
  return <nav aria-label="章节导航" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-line bg-reading px-4 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] md:hidden">
    <div className="min-w-0 [&>a]:flex [&>a]:min-h-12 [&>a]:items-center [&>a]:justify-center [&>a]:gap-2 [&>a]:rounded-full [&>a]:px-3 [&>a]:text-sm [&>a]:text-muted [&>a:hover]:bg-surface-soft [&>a:hover]:text-ink">{previous || <span aria-disabled="true" className="flex min-h-12 items-center justify-center text-sm text-faint">已是首章</span>}</div>
    <div className="[&>a]:flex [&>a]:min-h-12 [&>a]:items-center [&>a]:justify-center [&>a]:gap-2 [&>a]:rounded-full [&>a]:bg-surface-soft [&>a]:px-5 [&>a]:text-sm [&>a]:font-medium [&>a:hover]:bg-surface-hover">{contents}</div>
    <div className="min-w-0 [&>a]:flex [&>a]:min-h-12 [&>a]:items-center [&>a]:justify-center [&>a]:gap-2 [&>a]:rounded-full [&>a]:px-3 [&>a]:text-sm [&>a]:text-accent [&>a:hover]:bg-accent-soft">{next || <span aria-disabled="true" className="flex min-h-12 items-center justify-center text-sm text-faint">已到末章</span>}</div>
  </nav>;
}
