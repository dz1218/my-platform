'use client';
import { MemoryPanelBody, type MemoryPanelProps } from '@my-platform/web-ui/memory-panel';
export function MobileMemoryPanel(props: MemoryPanelProps) {
  return <section aria-labelledby="mobile-memory-title" className="space-y-3 px-5 py-4"><h3 id="mobile-memory-title" className="text-base font-semibold">记忆</h3><MemoryPanelBody {...props} /></section>;
}
