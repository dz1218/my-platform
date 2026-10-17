'use client';

import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

type Navigation = { paused: boolean; prepareChat: () => void; captureNavigationIntent: () => () => boolean; registerChatRoute: () => () => void };
const NavigationContext = createContext<Navigation>({ paused: false, prepareChat: () => {}, captureNavigationIntent: () => () => false, registerChatRoute: () => () => {} });
export const useCompanionNavigation = () => useContext(NavigationContext);

/** The stable browsing owner supplies lifecycle commands; Next still owns the actual chat route. */
export function CompanionNavigation({ children, paused, prepareChat, captureNavigationIntent, registerChatRoute }: Navigation & { children: ReactNode }) {
  const value = useMemo(() => ({ paused, prepareChat, captureNavigationIntent, registerChatRoute }), [paused, prepareChat, captureNavigationIntent, registerChatRoute]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function CompanionChatRoute({ children, chat }: { children: ReactNode; chat: ReactNode }) {
  const active = usePathname().startsWith('/chat/');
  const { registerChatRoute } = useCompanionNavigation();
  const overlay = useRef<HTMLDivElement>(null);
  // Register while the companion route is still visible, before its first
  // intercepted chat commits. Otherwise hiding the background for one commit
  // collapses the document and the browser clamps its scroll position to zero.
  useLayoutEffect(() => registerChatRoute(), [registerChatRoute]);
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const body = document.body;
    const oldRootOverflow = root.style.overflow;
    const oldBodyOverflow = body.style.overflow;
    const oldOverscroll = root.style.overscrollBehavior;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    overlay.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = oldRootOverflow;
      body.style.overflow = oldBodyOverflow;
      root.style.overscrollBehavior = oldOverscroll;
    };
  }, [active]);
  return <>
    {children}
    {active && <div ref={overlay} tabIndex={-1} className="companion-chat-overlay" data-testid="chat-overlay">{chat}</div>}
  </>;
}
