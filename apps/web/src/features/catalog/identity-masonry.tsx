'use client';
import { VirtuosoMasonry, type ItemContent } from '@virtuoso.dev/masonry';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Identity } from '@/types/companion';

export function IdentityMasonry<T extends Identity, C>({ items, context, ItemContent, paused = false, autoLoad = true, hasNextPage, loading, error, loadMore }: {
  items: T[]; context: C; ItemContent: ItemContent<T, C>; paused?: boolean; autoLoad?: boolean;
  hasNextPage: boolean; loading: boolean; error: Error | null; loadMore: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [intersecting, setIntersecting] = useState(false);
  useLayoutEffect(() => {
    if (!container.current || paused) return;
    const update = () => {
      const width = container.current?.clientWidth ?? 0;
      setColumns(width < 480 ? 1 : width < 760 ? 2 : width < 1040 ? 3 : 4);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [paused]);
  useEffect(() => {
    if (!sentinel.current || paused || !autoLoad) return;
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting), { rootMargin: '600px 0px' });
    observer.observe(sentinel.current);
    return () => { observer.disconnect(); setIntersecting(false); };
  }, [paused, autoLoad]);
  useEffect(() => {
    if (!paused && autoLoad && intersecting && hasNextPage && !loading && !error) loadMore();
  }, [paused, autoLoad, intersecting, hasNextPage, loading, error, loadMore]);
  return <div ref={container} data-testid="identity-catalog" data-loaded-count={items.length} data-columns={columns}>
    {items.length > 0 && <div className="-mx-2"><VirtuosoMasonry data={items} columnCount={columns} useWindowScroll initialItemCount={Math.min(6, items.length)} ItemContent={ItemContent} context={context} /></div>}
    <div ref={sentinel} className="flex min-h-20 flex-col items-center justify-center gap-3 py-5" aria-live="polite">
      {error && <p role="alert" className="text-sm text-rose-700">{error.message}</p>}
      {loading ? <p role="status" className="text-sm text-muted">正在加载更多…</p> : hasNextPage ? <button type="button" className="btn-secondary" disabled={paused} onClick={loadMore}>{error ? '重试加载' : '加载更多'}</button> : items.length > 0 ? <p className="text-xs text-muted">已经看到全部了</p> : null}
    </div>
  </div>;
}
