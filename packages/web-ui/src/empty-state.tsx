import type { LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return <div role="status" className="flex min-h-80 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
    <div aria-hidden="true" className="mb-6 flex items-center gap-6 text-muted">
      <span className="h-px w-14 bg-line" />
      <Icon className="size-12" strokeWidth={1.25} />
      <span className="h-px w-14 bg-line" />
    </div>
    <h3 className="text-sm font-normal text-muted">{title}</h3>
  </div>;
}
