'use client';
import { useSyncExternalStore } from 'react';
import { InlineLoading } from './page-skeleton';

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

export function ViewportLoading() {
  return <InlineLoading label="正在准备页面…" />;
}
