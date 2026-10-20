'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createAuthTransitionStore } from '@/stores/auth/transition';
import { useStoreInstance } from '@/stores/use-store-instance';
import { useRouter } from 'next/navigation';

type AuthExitScope = { store: ReturnType<typeof createAuthTransitionStore>; dismiss: () => Promise<void>; onHomeReady: () => void };
const AuthExitContext = createContext<AuthExitScope | null>(null);
export function useAuthExit() {
  const scope = useContext(AuthExitContext);
  if (!scope) throw new Error('AuthExitTransition is required');
  const closing = useStore(scope.store, s => s.closing);
  return { closing, dismiss: scope.dismiss, onHomeReady: scope.onHomeReady };
}

/** Stays mounted across the auth/home boundary so the animation can finish. */
export function AuthExitTransition({ children }: { children: ReactNode }) {
  const router = useRouter();
  const store = useStoreInstance(createAuthTransitionStore);
  const { setClosing } = store.getState();
  const running = useRef(false);
  const committed = useRef<(() => void) | null>(null);
  const outgoing = useRef<Animation | undefined>(undefined);
  const incoming = useRef<Animation | undefined>(undefined);

  const onHomeReady = useCallback(() => {
    // The pathname can commit while AppFrame still shows its Suspense fallback.
    // Wait for the real shell with its saved sidebar layout before revealing it.
    committed.current?.();
    committed.current = null;
  }, []);

  useEffect(() => () => {
    committed.current?.();
    outgoing.current?.cancel();
    incoming.current?.cancel();
  }, []);

  const dismiss = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setClosing(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const destinationReady = new Promise<void>(resolve => { committed.current = resolve; });
    const navigate = () => {
      router.replace('/', { scroll: true });
      return destinationReady;
    };

    try {
      if (!reducedMotion) {
        // Give feedback immediately, without freezing a full-page snapshot or
        // waiting for an outgoing animation before starting the route request.
        outgoing.current = document.querySelector<HTMLElement>('.auth-page')?.animate?.([
          { opacity: 1 },
          { opacity: 0.8 },
        ], { duration: 100, easing: 'ease-out', fill: 'forwards' });
      }
      await navigate();
      if (!reducedMotion) {
        // Opacity leaves fixed navigation and the saved sidebar geometry intact.
        incoming.current = document.querySelector<HTMLElement>('.app-shell')?.animate?.([
          { opacity: 0.8 },
          { opacity: 1 },
        ], { duration: 140, easing: 'ease-out' });
      }
      document.getElementById('main-content')?.focus({ preventScroll: true });
      await incoming.current?.finished.catch(() => {});
    } catch {
      // Closing remains usable if a browser cannot animate the navigation.
      router.replace('/');
    } finally {
      committed.current = null;
      outgoing.current?.cancel();
      outgoing.current = undefined;
      incoming.current?.cancel();
      incoming.current = undefined;
      running.current = false;
      setClosing(false);
    }
  }, [router, setClosing]);

  const scope = useMemo(() => ({ store, dismiss, onHomeReady }), [store, dismiss, onHomeReady]);
  return <AuthExitContext.Provider value={scope}>{children}</AuthExitContext.Provider>;
}
