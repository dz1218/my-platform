import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded bg-surface-soft', className)} />;
}

/** Content-sized placeholders stay in normal flow and never cover page controls. */
export function SkeletonRegion({ kind, label, className, children }: {
  kind: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return <div data-skeleton={kind} role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className={cn('motion-safe:animate-pulse', className)}>{children}</div>
  </div>;
}
