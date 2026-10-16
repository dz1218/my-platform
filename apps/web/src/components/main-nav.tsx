"use client";
import NextLink from "next/link";
import {
  BookOpen,
  Info,
  MessageCircle,
  LogIn,
  LogOut,
  Sparkles,
  TvMinimalPlay,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/features/identity/avatar";
import { AuthExitTransition, useAuthExit } from "@/features/auth/auth-exit-transition";
import { logoutAction } from "@/lib/actions";
import { SubmitButton } from "./submit-button";
import { InteractionNoticeDialog, InteractionNoticeTrigger } from "./interaction-notice-dialog";
import { useAppUI } from '@/stores/provider';
import { appSelectors } from '@/stores/app';
import { RadioMark } from "./radio-mark";
import { NavigationGlyph, type NavigationGlyphName } from "./navigation-glyph";
import { cn } from "@/lib/utils";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import type { User } from "@/types/companion";

function Link({
  href,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href" | "onNavigate"> & {
  href: string;
}) {
  return (
    <NextLink
      {...props}
      href={href}
      onNavigate={(event) => {
        // Next refreshes dynamic server data when navigating to the current URL.
        // Navigation chrome should simply return to the top of that page.
        if (new URL(href, window.location.href).href === window.location.href) {
          event.preventDefault();
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      }}
    />
  );
}

const links = [
  {
    label: "陪伴",
    href: "/companion",
    icon: MessageCircle,
    glyph: "companion",
  },
  { label: "直播", href: "/live", icon: TvMinimalPlay, glyph: "live" },
  { label: "小说", href: "/novels", icon: BookOpen, glyph: "novels" },
  { label: "我的", href: "/me", icon: UserRound, glyph: "account" },
] satisfies {
  label: string;
  href: string;
  icon: typeof MessageCircle;
  glyph: NavigationGlyphName;
}[];

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: User | null;
}) {
  const path = usePathname();
  // Auth has its own persistent layout, including while search params hydrate.
  return <AuthExitTransition>{path === "/login" || path === "/register" ? children : (
    <Suspense
      fallback={
        <div className="app-shell">
          <div className="app-content">{children}</div>
        </div>
      }
    >
      <AppFrame user={user}>{children}</AppFrame>
    </Suspense>
  )}</AuthExitTransition>;
}

function AppFrame({
  children,
  user,
}: {
  children: ReactNode;
  user: User | null;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const collapsed = useAppUI(appSelectors.collapsed);
  const layoutReady = useAppUI(appSelectors.layoutReady);
  const hydrateSidebar = useAppUI(s => s.hydrateSidebar);
  const toggleSidebar = useAppUI(s => s.toggleSidebar);
  const { onHomeReady } = useAuthExit();
  useLayoutEffect(() => { hydrateSidebar(); }, [hydrateSidebar]);
  useLayoutEffect(() => {
    if (layoutReady && path === "/companion") onHomeReady();
  }, [layoutReady, path, onHomeReady]);
  const immersive =
    path.startsWith("/chat/") ||
    /^\/live\/[^/]+$/.test(path) ||
    /^\/novels\/[^/]+\/chapters\/[^/]+$/.test(path) ||
    (path === "/operator" && !!params.get("id"));
  return (
    <div
      className="app-shell md:theme-graphite md:bg-canvas md:text-ink"
      data-immersive={immersive}
      data-nav-collapsed={collapsed}
    >
      <MainNav user={user} collapsed={collapsed} onToggle={toggleSidebar} />
      <div
        className={cn(
          "app-content md:min-h-dvh md:bg-canvas",
          !immersive && "relative isolate app-content-ambient",
        )}
      >
        {!immersive && (
          <div aria-hidden="true" className="shell-ambient" />
        )}
        {children}
      </div>
      <nav aria-label="手机主导航" className="mobile-nav">
        <NavigationLinks path={path} />
      </nav>
    </div>
  );
}

function NavigationLinks({
  path,
  desktop = false,
  showAccount = true,
}: {
  path: string;
  desktop?: boolean;
  showAccount?: boolean;
}) {
  return links.filter(link => showAccount || link.href !== '/me').map(({ label, href, icon: Icon, glyph }) => {
    const active =
      path.startsWith(href) ||
      (href === "/companion" && path.startsWith("/chat")) ||
      (href === "/me" && (path === "/operator" || path === "/choose-identity"));
    return (
      <Link
        key={href}
        href={href}
        aria-label={label}
        title={desktop ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn("nav-item", active && "nav-item-active")}
      >
        {desktop ? (
          <NavigationGlyph name={glyph} />
        ) : (
          <Icon aria-hidden="true" size={21} strokeWidth={1.75} />
        )}
        <span className={desktop ? "nav-collapse-label" : undefined}>
          {label}
        </span>
      </Link>
    );
  });
}

function AccountMenu({ user, collapsed }: { user: User; collapsed: boolean }) {
  const path = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const anchorPosition = useRef<{ top: number; bottom: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);
  const label = `账户与身份 · ${user.name}`;
  const itemClass = "flex min-h-14 items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function openOnHover() {
    clearTimers();
    if (noticeOpen || panel.current?.matches(":popover-open")) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      openedByHover.current = true;
      // Hover must not move keyboard focus away from the current page.
      panel.current?.showPopover();
    }, 120);
  }

  function closeOnLeave() {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (openedByHover.current && !panel.current?.contains(document.activeElement)) {
        panel.current?.hidePopover();
      }
    }, 250);
  }

  useEffect(() => {
    const dismiss = () => {
      clearTimers();
      panel.current?.hidePopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearTimers();
      if (!panel.current?.matches(":popover-open")) return;
      const focusInPanel = panel.current.contains(document.activeElement);
      event.preventDefault();
      panel.current.hidePopover();
      if (focusInPanel) trigger.current?.focus({ preventScroll: true });
    };
    dismiss();
    window.addEventListener("resize", dismiss);
    // Ignore delayed scroll events from bringing the trigger into view.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      const bounds = trigger.current?.getBoundingClientRect();
      const anchor = anchorPosition.current;
      if (bounds && anchor && (Math.abs(bounds.top - anchor.top) > 1 || Math.abs(bounds.bottom - anchor.bottom) > 1)) {
        dismiss();
      }
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimers();
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [path, collapsed]);

  return <>
    <button
      ref={trigger}
      type="button"
      popoverTarget="account-navigation"
      aria-expanded={open}
      aria-controls="account-navigation"
      aria-label={label}
      onPointerEnter={event => {
        if (event.pointerType === "mouse") openOnHover();
      }}
      onPointerLeave={closeOnLeave}
      onClick={event => {
        // A click after hover keeps the panel open; keyboard and touch also work.
        event.preventDefault();
        clearTimers();
        openedByHover.current = false;
        panel.current?.showPopover();
        panel.current?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
      }}
      className="nav-identity-link group/account w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-expanded:bg-surface-selected"
    >
      <span aria-hidden="true" className={cn(
        "grid shrink-0 place-items-center rounded-full bg-surface-selected font-medium text-ink transition-colors group-hover/account:bg-surface-hover group-focus-visible/account:bg-surface-hover",
        collapsed ? "size-8 text-xs" : "size-10 text-base",
      )}>{user.name?.slice(-1) || "我"}</span>
      <span className="nav-collapse-label min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={user.name}>{user.name}</span>
        <span className="mt-0.5 block text-xs text-muted">账户与身份</span>
      </span>
    </button>
    <div
      ref={panel}
      id="account-navigation"
      popover="auto"
      role="navigation"
      aria-label="账户与身份"
      onBeforeToggle={event => {
        if (event.newState === "closed") {
          clearTimers();
          return;
        }
        if (!trigger.current || !panel.current) return;
        const bounds = trigger.current.getBoundingClientRect();
        anchorPosition.current = { top: bounds.top, bottom: bounds.bottom };
        panel.current.style.left = `${Math.min(bounds.right + 8, window.innerWidth - 316)}px`;
        const bottom = Math.max(16, window.innerHeight - bounds.bottom);
        panel.current.style.bottom = `${bottom}px`;
        panel.current.style.maxHeight = `${Math.max(0, window.innerHeight - bottom - 16)}px`;
      }}
      onToggle={event => {
        const expanded = event.newState === "open";
        setOpen(expanded);
      }}
      onPointerEnter={clearTimers}
      onPointerLeave={closeOnLeave}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) {
          panel.current?.hidePopover();
        }
      }}
      className="fixed inset-auto m-0 max-h-[calc(100dvh-2rem)] w-[300px] overflow-y-auto rounded-panel border border-line bg-panel p-2 text-ink shadow-popover"
    >
      <p className="px-3 pb-2 pt-3 text-xs font-medium text-muted">账户与身份</p>
      <Link href={user.inheritedIdentity ? "/operator" : "/choose-identity"} onClick={() => panel.current?.hidePopover()} className={itemClass}>
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-surface-soft">
          {user.inheritedIdentity ? <Avatar identity={user.inheritedIdentity} /> : <Sparkles aria-hidden="true" className="size-5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium" title={user.inheritedIdentity?.name}>{user.inheritedIdentity?.name ?? "拥有一个 AI 身份"}</span>
          <span className="mt-1 block text-xs text-muted">{user.inheritedIdentity ? "以此身份回复消息" : "以角色身份回复其他用户"}</span>
        </span>
      </Link>
      <div className="mx-3 my-2 border-t border-line" />
      <button type="button" aria-haspopup="dialog" onClick={() => {
        clearTimers();
        panel.current?.hidePopover();
        setNoticeOpen(true);
      }} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        <Info aria-hidden="true" className="size-4" />平台互动说明
      </button>
      <form action={logoutAction}>
        <SubmitButton pendingLabel="正在退出…" className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-sm text-muted transition-colors enabled:hover:bg-surface-hover enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
          <LogOut aria-hidden="true" className="size-4" />退出登录
        </SubmitButton>
      </form>
    </div>
    <InteractionNoticeDialog open={noticeOpen} onClose={() => setNoticeOpen(false)} returnFocusRef={trigger} />
  </>;
}

export function MainNav({
  user,
  collapsed,
  onToggle,
}: {
  user: User | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const path = usePathname();
  return (
    <header className="site-nav text-ink" data-collapsed={collapsed}>
      <div className="site-brand">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!collapsed}
          aria-controls="desktop-navigation"
          className="grid size-11 shrink-0 place-items-center rounded-control transition-colors hover:bg-surface-hover"
        >
          <RadioMark />
        </button>
        <Link
          href="/companion"
          aria-label="Radio Friday 首页"
          className="site-wordmark nav-collapse-label"
        >
          Radio Friday
        </Link>
      </div>
      <nav id="desktop-navigation" aria-label="主导航" className="primary-nav">
        <NavigationLinks path={path} desktop showAccount={!!user} />
      </nav>
      <div className="nav-footer">
        {user ? (
          <div className="nav-identity-card">
            <AccountMenu user={user} collapsed={collapsed} />
          </div>
        ) : <>
          <Link href="/login" aria-label="登录 / 注册" title={collapsed ? '登录 / 注册' : undefined} className="nav-footer-row nav-auth-link">
            <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center">
              <LogIn className="size-5" strokeWidth={1.75} />
            </span>
            <span className="nav-collapse-label">登录 / 注册</span>
          </Link>
          <InteractionNoticeTrigger aria-label="平台互动说明" title={collapsed ? '平台互动说明' : undefined} className="nav-privacy">
            <span aria-hidden="true" className="nav-privacy-icon">
              <Info className="size-3.5" strokeWidth={1.75} />
            </span>
            <span className="nav-collapse-label">平台互动说明</span>
          </InteractionNoticeTrigger>
        </>}
      </div>
    </header>
  );
}
