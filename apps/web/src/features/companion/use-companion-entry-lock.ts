'use client';

import { useLayoutEffect, useRef } from 'react';
import { companionSelectors, type createCompanionStore } from '@/stores/companion';

/** The directory owns the request; this adapter owns only browser interaction resources. */
export function useCompanionEntryLock(store: ReturnType<typeof createCompanionStore>, paused: boolean) {
  const page = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (paused) return;
    const shell = page.current?.closest<HTMLElement>('.app-shell');
    if (!shell) return;
    let release: (() => void) | undefined;
    const sync = (locked: boolean) => {
      if (!locked) { release?.(); release = undefined; return; }
      if (release) return;
      const wasInert = shell.inert;
      shell.inert = true;
      // Inert prevents focus/clicks, but does not stop scrolling or document-level
      // gestures. Capture those too, without changing scrollbar/card geometry.
      const block = (event: Event) => {
        if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey || event.altKey)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const events = ['click', 'auxclick', 'pointerdown', 'keydown', 'touchstart', 'touchmove', 'wheel', 'submit'];
      for (const event of events) window.addEventListener(event, block, { capture: true, passive: false });
      release = () => {
        shell.inert = wasInert;
        for (const event of events) window.removeEventListener(event, block, true);
      };
    };
    // Subscribe synchronously so the next input is blocked even before React
    // commits the selected card's loading state.
    const unsubscribe = store.subscribe(companionSelectors.entryLocked, sync, { fireImmediately: true });
    return () => { unsubscribe(); release?.(); };
  }, [store, paused]);
  return page;
}
