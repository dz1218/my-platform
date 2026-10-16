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
  const transition = useRef<ViewTransition | null>(null);
  const outgoing = useRef<Animation | undefined>(undefined);

  const onHomeReady = useCallback(() => {
    // The pathname can commit while AppFrame still shows its Suspense fallback.
    // Wait for the real shell with its saved sidebar layout before revealing it.
    committed.current?.();
    committed.current = null;
  }, []);

  useEffect(() => () => {
    committed.current?.();
    transition.current?.skipTransition();
    outgoing.current?.cancel();
    document.documentElement.removeAttribute('data-auth-exit');
  }, []);

  const dismiss = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setClosing(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const destinationReady = new Promise<void>(resolve => { committed.current = resolve; });
    const navigate = () => {
      router.replace('/companion', { scroll: true });
      return destinationReady;
    };

    try {
      if (!reducedMotion && typeof document.startViewTransition === 'function') {
        document.documentElement.dataset.authExit = 'native';
        const current = document.startViewTransition(navigate);
        transition.current = current;
        // A hidden tab or a slow response may skip the visual transition.
        void current.ready.catch(() => {});
        await current.finished;
      } else {
        if (!reducedMotion) {
          outgoing.current = document.querySelector<HTMLElement>('.auth-page')?.animate?.([
            { opacity: 1, transform: 'none' },
            { opacity: 0.35, transform: 'translateY(-8px) scale(.985)' },
          ], { duration: 180, easing: 'ease-out', fill: 'forwards' });
          await outgoing.current?.finished.catch(() => {});
        }
        // Keep the outgoing page visible while the destination is loading.
        await navigate();
        if (!reducedMotion) {
          const incoming = document.querySelector<HTMLElement>('.app-shell')?.animate?.([
            { opacity: 0.35 },
            { opacity: 1 },
          ], { duration: 280, easing: 'ease-out' });
          await incoming?.finished.catch(() => {});
        }
      }
      document.getElementById('main-content')?.focus({ preventScroll: true });
    } catch {
      // Closing remains usable if a browser cannot animate the navigation.
      router.replace('/companion');
    } finally {
      committed.current = null;
      transition.current = null;
      outgoing.current?.cancel();
      outgoing.current = undefined;
      document.documentElement.removeAttribute('data-auth-exit');
      running.current = false;
      setClosing(false);
    }
  }, [router, setClosing]);

  const scope = useMemo(() => ({ store, dismiss, onHomeReady }), [store, dismiss, onHomeReady]);
  return <AuthExitContext.Provider value={scope}>{children}</AuthExitContext.Provider>;
}
