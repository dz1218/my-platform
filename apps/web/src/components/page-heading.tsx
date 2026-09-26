import type { ReactNode } from 'react';

/** Shared title baseline and action placement for the four primary destinations. */
export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="page-heading">
    <div className="min-w-0"><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}
