'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { CompanionHome } from '@/features/companion/companion-home';
import { CompanionNavigation } from '@/features/companion/companion-navigation';
import { ProfilePage } from '@/features/account/profile-page';
import { NovelShelf } from '@/features/novels/novel-shelf';
import { LiveLobbyPage } from './live/live-lobby-page';
import { useBrowseUI } from '@/stores/provider';
import type { User } from '@/types/companion';

type ScrollSnapshot = {
  y: number;
  width: number;
  anchorId?: string;
  anchorIndex?: number;
  anchorTop?: number;
  contentAnchor?: { key: string; top: number };
  focus: HTMLElement | null;
  focusIdentityId?: string;
  bounds?: { top: number; left: number; width: number };
};

type BrowseNavigation = {
  prepareNavigation: (href: string) => void;
  hrefForTab: (href: string) => string;
  background: RefObject<HTMLDivElement | null>;
  pageContent: RefObject<HTMLDivElement | null>;
  backgroundSnapshot: RefObject<ScrollSnapshot | null>;
  companionVisible: boolean;
  companionPaused: boolean;
  restorationPending: boolean;
};

const BrowseContext = createContext<BrowseNavigation | null>(null);
const isCompanion = (href: string) => href.split('?')[0] === '/companion';
const isChat = (href: string) => href.split('?')[0].startsWith('/chat/');

export function useBrowseNavigation() {
  const value = useContext(BrowseContext);
  if (!value) throw new Error('BrowseNavigationProvider is required');
  return value;
}

/** Browser snapshots belong to this account-scoped owner, never storage or a server singleton. */
export function BrowseNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = pathname + (search ? `?${search}` : '');
  const lastCompanionHref = useBrowseUI(s => s.lastCompanionHref);
  const rememberCompanionHref = useBrowseUI(s => s.rememberCompanionHref);
  const currentHref = useRef(href);
  const navigationGeneration = useRef(0);
  const snapshots = useRef(new Map<string, ScrollSnapshot>());
  const background = useRef<HTMLDivElement>(null);
  const pageContent = useRef<HTMLDivElement>(null);
  const backgroundSnapshot = useRef<ScrollSnapshot | null>(null);
  const restoring = useRef(false);
  const [restoringHref, setRestoringHref] = useState<string | null>(null);
  const restorationPending = !isChat(href) && (restoringHref === href || (currentHref.current !== href && snapshots.current.has(href)));
  const cancelRestore = useRef<(() => void) | null>(null);
  // A mounted route owner's presentation registration, not cached route data.
  const [chatOwner, setChatOwner] = useState<object | null>(null);
  const activeChatOwner = useRef<object | null>(null);

  const capture = useCallback(() => {
    const current = currentHref.current;
    // An intercepted chat locks the background's window position. Its own history scroll is separate.
    if (isChat(current) || restoring.current) return;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const snapshot: ScrollSnapshot = { y: window.scrollY, width: window.innerWidth, focus: null };
    if (isCompanion(current) && background.current) {
      const bounds = background.current.getBoundingClientRect();
      snapshot.bounds = { top: bounds.top, left: bounds.left, width: bounds.width };
      const cards = [...background.current.querySelectorAll<HTMLElement>('[data-identity-id]')];
      const anchor = cards.filter(card => card.getBoundingClientRect().bottom > 0)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      snapshot.anchorId = anchor?.dataset.identityId;
      snapshot.anchorIndex = anchor ? Number(anchor.dataset.identityIndex) : undefined;
      snapshot.anchorTop = anchor?.getBoundingClientRect().top;
      snapshot.focus = focus;
      snapshot.focusIdentityId = focus?.closest<HTMLElement>('[data-identity-id]')?.dataset.identityId;
      backgroundSnapshot.current = snapshot;
    } else if (pageContent.current && snapshot.y > 0) {
      // Explicit content markers exclude navigation, filters and repeated links
      // within one card. Store only stable data, never an unmounted page's DOM.
      const anchor = [...pageContent.current.querySelectorAll<HTMLElement>('[data-browse-anchor]')]
        .map(element => ({ element, bounds: element.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight)
        .sort((a, b) => a.bounds.top - b.bounds.top)[0];
      if (anchor?.element.dataset.browseAnchor) snapshot.contentAnchor = { key: anchor.element.dataset.browseAnchor, top: anchor.bounds.top };
    }
    snapshots.current.set(current, snapshot);
  }, []);

  const prepareNavigation = useCallback((target: string) => {
    const url = new URL(target, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (isCompanion(currentHref.current) && !isCompanion(url.pathname)) navigationGeneration.current++;
    cancelRestore.current?.();
    capture();
  }, [capture]);
  const prepareChat = useCallback(() => prepareNavigation('/chat/'), [prepareNavigation]);
  const captureNavigationIntent = useCallback(() => {
    const generation = navigationGeneration.current;
    return () => navigationGeneration.current === generation && isCompanion(currentHref.current) && window.location.pathname === '/companion';
  }, []);
  const registerChatRoute = useCallback(() => {
    const owner = {};
    activeChatOwner.current = owner;
    setChatOwner(owner);
    return () => {
      if (activeChatOwner.current !== owner) return;
      activeChatOwner.current = null;
      setChatOwner(null);
    };
  }, []);

  useEffect(() => {
    const originalRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const beforeClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      prepareNavigation(anchor.href);
    };
    const onScroll = () => capture();
    const onHistory = () => {
      if (isCompanion(currentHref.current) && window.location.pathname !== '/companion') navigationGeneration.current++;
    };
    const stopRestoring = () => cancelRestore.current?.();
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopRestoring();
    };
    document.addEventListener('click', beforeClick, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onHistory);
    window.addEventListener('wheel', stopRestoring, { passive: true });
    window.addEventListener('touchstart', stopRestoring, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      cancelRestore.current?.();
      window.history.scrollRestoration = originalRestoration;
      document.removeEventListener('click', beforeClick, true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('wheel', stopRestoring);
      window.removeEventListener('touchstart', stopRestoring);
      window.removeEventListener('keydown', onKey);
    };
  }, [capture, prepareNavigation]);

  useLayoutEffect(() => {
    const previous = currentHref.current;
    if (isCompanion(previous) && !isCompanion(href)) navigationGeneration.current++;
    currentHref.current = href;
    if (isCompanion(href)) rememberCompanionHref(href);
    if (previous === href) return;
    cancelRestore.current?.();
    if (isChat(href)) return;
    const saved = snapshots.current.get(href);
    const wantedY = saved?.y ?? 0;
    const contentAnchor = !isCompanion(href) && saved?.width !== window.innerWidth ? saved?.contentAnchor : undefined;
    const clampY = (y: number) => Math.max(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight));
    restoring.current = true;
    setRestoringHref(saved ? href : null);
    const content = isCompanion(href) ? background.current : pageContent.current;
    const originalVisibility = content?.style.visibility ?? '';
    const holdContent = () => { if (content && saved) content.style.visibility = 'hidden'; };
    const revealContent = () => { if (content) content.style.visibility = originalVisibility; };
    // Resizing may change the column count after this first layout pass. Keep
    // the content measured while its anchor settles, without hiding navigation.
    if (saved && saved.width !== window.innerWidth) holdContent();
    let frame = 0;
    let attempts = 0;
    let stable = 0;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(frame);
      restoring.current = false;
      setRestoringHref(null);
      revealContent();
      if (cancelRestore.current === finish) cancelRestore.current = null;
      if (isCompanion(href) && isChat(previous) && saved) {
        const focus = saved.focus?.isConnected ? saved.focus : [...(background.current?.querySelectorAll<HTMLElement>('[data-identity-id]') ?? [])]
          .find(card => card.dataset.identityId === saved.focusIdentityId)?.querySelector<HTMLElement>('a, button');
        focus?.focus({ preventScroll: true });
      }
      capture();
    };
    cancelRestore.current = finish;
    const align = () => {
      if (cancelled) return;
      let settled = true;
      if (attempts === 0 || !(isCompanion(href) ? saved?.anchorId : contentAnchor)) {
        const y = isCompanion(href) ? wantedY : clampY(wantedY);
        if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo({ top: y, behavior: 'instant' });
        settled = Math.abs(window.scrollY - y) <= 0.5;
      }
      if (isCompanion(href) && saved?.anchorId && saved.anchorTop !== undefined) {
        const cards = [...(background.current?.querySelectorAll<HTMLElement>('[data-identity-id]') ?? [])];
        const anchor = cards.find(card => card.dataset.identityId === saved.anchorId);
        if (anchor) {
          const delta = anchor.getBoundingClientRect().top - saved.anchorTop;
          if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
          settled = Math.abs(delta) <= 0.5;
        } else {
          settled = false;
          if (cards.length && saved.anchorIndex !== undefined) {
            const nearest = cards.reduce((best, card) => Math.abs(Number(card.dataset.identityIndex) - saved.anchorIndex!) < Math.abs(Number(best.dataset.identityIndex) - saved.anchorIndex!) ? card : best);
            const columns = Number(background.current?.querySelector<HTMLElement>('[data-columns]')?.dataset.columns ?? 1);
            const distance = saved.anchorIndex - Number(nearest.dataset.identityIndex);
            window.scrollBy({ top: distance * nearest.getBoundingClientRect().height / columns, behavior: 'instant' });
          }
        }
      } else if (contentAnchor) {
        const anchor = [...(pageContent.current?.querySelectorAll<HTMLElement>('[data-browse-anchor]') ?? [])]
          .find(element => element.dataset.browseAnchor === contentAnchor.key && element.getBoundingClientRect().height > 0);
        // A live room may have disappeared while away. Fall back to the nearest
        // valid window position instead of waiting for a removed item to return.
        const y = clampY(anchor ? window.scrollY + anchor.getBoundingClientRect().top - contentAnchor.top : wantedY);
        if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo({ top: y, behavior: 'instant' });
        settled = Math.abs(window.scrollY - y) <= 0.5;
      }
      if (!settled) holdContent();
      stable = settled ? stable + 1 : 0;
      if (++attempts < 180 && stable < (saved?.width === window.innerWidth ? 5 : 12)) frame = requestAnimationFrame(align);
      else finish();
    };
    align();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      restoring.current = false;
      revealContent();
      if (cancelRestore.current === finish) cancelRestore.current = null;
    };
  }, [href, capture, rememberCompanionHref]);

  const hrefForTab = useCallback((target: string) => target === '/companion' ? lastCompanionHref : target, [lastCompanionHref]);
  const companionPaused = pathname !== '/companion';
  const companionVisible = !companionPaused || (isChat(href) && chatOwner !== null);
  const value = useMemo(() => ({ prepareNavigation, hrefForTab, background, pageContent, backgroundSnapshot, companionVisible, companionPaused, restorationPending }), [prepareNavigation, hrefForTab, companionVisible, companionPaused, restorationPending]);
  return <BrowseContext.Provider value={value}>
    <CompanionNavigation paused={companionPaused} prepareChat={prepareChat} captureNavigationIntent={captureNavigationIntent} registerChatRoute={registerChatRoute}>{children}</CompanionNavigation>
  </BrowseContext.Provider>;
}

/** Keep only the measured catalog mounted; ordinary route content continues to have one owner. */
export function BrowsingPages({ children, user }: { children: ReactNode; user: User | null }) {
  const pathname = usePathname();
  const navigation = useBrowseNavigation();
  const visited = useRef(pathname === '/companion');
  if (pathname === '/companion') visited.current = true;
  const bounds = navigation.backgroundSnapshot.current?.bounds;
  const ordinaryPage = pathname === '/' ? <LiveLobbyPage /> : pathname === '/me' ? <ProfilePage /> : pathname === '/novels' ? <NovelShelf /> : null;
  return <>
    {visited.current && <div className={navigation.companionVisible ? undefined : 'pointer-events-none invisible fixed inset-0 overflow-hidden'} aria-hidden={!navigation.companionVisible || navigation.companionPaused || undefined} inert={navigation.companionPaused}>
      <div ref={navigation.background} data-testid="companion-background" style={!navigation.companionVisible ? {
        position: 'absolute', top: bounds?.top ?? 0, left: bounds?.left ?? 0,
        width: bounds?.width ?? '100%',
      } : undefined}>
        <CompanionHome accountId={user?.id ?? null} inheritedIdentity={user?.inheritedIdentity} />
      </div>
    </div>}
    {ordinaryPage ? <div ref={navigation.pageContent}>{ordinaryPage}</div> : children}
  </>;
}
