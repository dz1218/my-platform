'use client';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

type Snapshot = { y: number; width: number; id?: string; index?: number; top?: number; focus: HTMLElement | null; focusIdentityId?: string };
const NavigationContext = createContext({ paused: false, prepareChat: () => {} });
export const useCompanionNavigation = () => useContext(NavigationContext);

/** The parallel route keeps the window-scrolling masonry mounted and measured. */
export function CompanionNavigation({ children, chat }: { children: ReactNode; chat: ReactNode }) {
  const path = usePathname();
  const active = path.startsWith('/chat/');
  const background = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const wasActive = useRef(false);
  const prepareChat = useCallback(() => {
    const cards = [...(background.current?.querySelectorAll<HTMLElement>('[data-identity-id]') ?? [])];
    const anchor = cards.filter(card => card.getBoundingClientRect().bottom > 0).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    snapshot.current = { focusIdentityId: focus?.closest<HTMLElement>('[data-identity-id]')?.dataset.identityId, y: window.scrollY, width: window.innerWidth, id: anchor?.dataset.identityId, index: Number(anchor?.dataset.identityIndex), top: anchor?.getBoundingClientRect().top, focus };
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    if (!snapshot.current) prepareChat();
    const root = document.documentElement;
    const body = document.body;
    const oldRootOverflow = root.style.overflow;
    const oldBodyOverflow = body.style.overflow;
    const oldOverscroll = root.style.overscrollBehavior;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    const nav = document.querySelector<HTMLElement>('.site-nav');
    const updateInset = () => {
      overlay.current?.style.setProperty('--chat-nav-height', `${window.innerWidth < 768 ? nav?.getBoundingClientRect().height ?? 120 : 0}px`);
    };
    updateInset();
    const observer = new ResizeObserver(updateInset);
    if (nav) observer.observe(nav);
    window.addEventListener('resize', updateInset);
    overlay.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = oldRootOverflow;
      body.style.overflow = oldBodyOverflow;
      root.style.overscrollBehavior = oldOverscroll;
      observer.disconnect();
      window.removeEventListener('resize', updateInset);
    };
  }, [active, prepareChat]);
  useLayoutEffect(() => {
    const restore = wasActive.current && !active && path === '/companion';
    wasActive.current = active;
    const saved = snapshot.current;
    if (!restore || !saved) return;
    window.scrollTo({ top: saved.y, behavior: 'instant' });
    let frame = 0;
    let stable = 0;
    let attempts = 0;
    const align = () => {
      const cards = [...(background.current?.querySelectorAll<HTMLElement>('[data-identity-id]') ?? [])];
      const anchor = cards.find(card => card.dataset.identityId === saved.id);
      if (anchor && saved.top !== undefined) {
        const delta = anchor.getBoundingClientRect().top - saved.top;
        if (Math.abs(delta) > 0.5) { window.scrollBy({ top: delta, behavior: 'instant' }); stable = 0; } else stable++;
      } else if (saved.width !== window.innerWidth && cards.length && saved.index !== undefined) {
        // Masonry has no scrollToIndex API. Walk its measured visible range after
        // an orientation change until the saved role is mounted, then align it.
        const nearest = cards.reduce((best, card) => Math.abs(Number(card.dataset.identityIndex) - saved.index!) < Math.abs(Number(best.dataset.identityIndex) - saved.index!) ? card : best);
        const columns = Number(background.current?.querySelector<HTMLElement>('[data-columns]')?.dataset.columns ?? 1);
        const distance = saved.index - Number(nearest.dataset.identityIndex);
        window.scrollBy({ top: distance * nearest.getBoundingClientRect().height / columns, behavior: 'instant' });
      } else stable++;
      if (++attempts < (saved.width === window.innerWidth ? 90 : 180) && stable < (saved.width === window.innerWidth ? 5 : 12)) frame = requestAnimationFrame(align);
      else {
        if (saved.focus?.isConnected) saved.focus.focus({ preventScroll: true });
        else (cards.find(card => card.dataset.identityId === saved.focusIdentityId) ?? anchor)?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
        snapshot.current = null;
      }
    };
    frame = requestAnimationFrame(align);
    return () => cancelAnimationFrame(frame);
  }, [active, path]);
  const value = useMemo(() => ({ paused: active, prepareChat }), [active, prepareChat]);
  return <NavigationContext.Provider value={value}>
    <div ref={background} inert={active} aria-hidden={active || undefined} data-testid="companion-background">{children}</div>
    {active && <div ref={overlay} tabIndex={-1} className="companion-chat-overlay" data-testid="chat-overlay">{chat}</div>}
  </NavigationContext.Provider>;
}
