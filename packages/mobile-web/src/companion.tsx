'use client';

import type { ReactNode } from 'react';
import { Avatar } from '@my-platform/web-ui/avatar';
import { SkeletonBlock, SkeletonRegion } from '@my-platform/web-ui/skeleton';

export function MobileCompanionHeading({ actions }: { actions?: ReactNode }) {
  return <header data-mobile-page="companion">
    <h1 className="sr-only">发现朋友</h1>
    {actions && <div className="mb-4 flex justify-end [&>a]:border-line [&>a]:bg-transparent [&>a]:px-3">{actions}</div>}
  </header>;
}

export function MobileFriendCard({ identity, index, action }: {
  identity: { id: string; name: string; age: number; city?: string; occupation?: string; background?: string };
  index: number; action: ReactNode;
}) {
  // Skip the generated opening when it repeats the city and occupation above.
  const opening = `在${identity.city}生活，是一名${identity.occupation}。`;
  const background = identity.background?.startsWith(opening) ? identity.background.slice(opening.length) : identity.background;
  const summary = background?.match(/[^。！？]+[。！？]?/u)?.[0];
  // Two equal columns, 12px gutter; natural text height determines the masonry.
  return <div className="px-1.5 pb-3"><article data-identity-id={identity.id} data-identity-index={index} className="relative min-w-0 rounded-panel border border-line/40 bg-surface-soft p-3">
    <div className="flex items-center gap-2 [&>div]:bg-panel"><Avatar identity={identity} /><h3 className="min-w-0 break-words text-base font-semibold leading-6">{identity.name}</h3></div>
    <p className="mt-2 text-xs leading-5 text-muted">{identity.age} 岁{identity.city ? ` · ${identity.city}` : ''}</p>
    {identity.occupation && <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{identity.occupation}</p>}
    {summary && <p className="mt-2 line-clamp-3 break-words text-sm leading-5 text-muted">{summary}</p>}
    <div className="mt-1">{action}</div>
  </article></div>;
}

export function MobileCatalogSkeleton({ label = '正在寻找可以认识的人…' }: { label?: string }) {
  return <SkeletonRegion kind="catalog" label={label} className="grid grid-cols-2 items-start gap-3">
    {[0, 1].map(column => <div key={column} className="grid gap-3">{[0, 1].map(row => <div key={row} className="rounded-panel border border-line/40 bg-surface-soft p-3"><div className="flex items-center gap-2"><SkeletonBlock className="bg-surface-selected size-9 shrink-0 rounded-full" /><SkeletonBlock className="bg-surface-selected h-5 w-12" /></div><SkeletonBlock className="bg-surface-selected mt-2 h-3 w-2/3" /><SkeletonBlock className="bg-surface-selected mt-2 h-3 w-full" /><SkeletonBlock className="bg-surface-selected mt-3 h-4 w-full" /><SkeletonBlock className="bg-surface-selected mt-1 h-4 w-4/5" />{column !== row && <SkeletonBlock className="bg-surface-selected mt-1 h-4 w-1/2" />}<SkeletonBlock className="bg-surface-selected mt-3 h-4 w-2/3 rounded" /></div>)}</div>)}
  </SkeletonRegion>;
}
