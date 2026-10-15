'use client';
import { useSyncExternalStore } from 'react';

export type ViewportMode = 'mobile' | 'desktop';
const query = '(min-width: 768px)';
function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
const snapshot = (): ViewportMode => window.matchMedia(query).matches ? 'desktop' : 'mobile';
const serverSnapshot = () => null;

/** A stable hydration snapshot; controllers must live above the selected view. */
export function useViewport(): ViewportMode | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function ViewportSkeleton() {
  return <div role="status" aria-label="正在加载页面" className="space-y-5 py-6">
    <div className="h-8 w-40 rounded-control bg-surface-soft" />
    <div className="h-36 rounded-panel bg-surface-soft" />
    <div className="h-52 rounded-panel bg-panel" />
    <span className="sr-only">正在加载页面…</span>
  </div>;
}
