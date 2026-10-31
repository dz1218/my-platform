"use client";
import {
  MobileNavigation,
  type MobileNavigationLinkProps,
} from "@my-platform/mobile-web/navigation";
import NextLink, { useLinkStatus } from "next/link";
import { LoadingPlaceholder } from "./page-skeleton";
import { AccountStartupContent } from "./account-startup-content";
import { SkeletonBlock, SkeletonRegion } from "./skeleton";
import {
  BrowseNavigationProvider,
  BrowsingPages,
  useBrowseNavigation,
} from "./browse-navigation";
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
import { useCurrentAccount } from "@/features/account/use-current-account";
import { AuthExitTransition } from "@/features/auth/auth-exit-transition";
import { logoutAction } from "@/lib/actions";
import { SubmitButton } from "./submit-button";
import {
  InteractionNoticeDialog,
  InteractionNoticeTrigger,
} from "./interaction-notice-dialog";
import { useAppUI } from "@/stores/provider";
import { appSelectors } from "@/stores/app";
import { RadioMark } from "./radio-mark";
import { NavigationGlyph, type NavigationGlyphName } from "./navigation-glyph";
import { cn } from "@/lib/utils";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import type { User } from "@/types/companion";

function Link({
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href" | "onNavigate"> & {
  href: string;
}) {
  const pendingHref = useAppUI((s) => s.pendingHref);
  const beginNavigation = useAppUI((s) => s.beginNavigation);
  const cancelNavigation = useAppUI((s) => s.cancelNavigation);
  const ticket = useRef<number | null>(null);
  const { prepareNavigation, hrefForTab } = useBrowseNavigation();
  const targetHref = hrefForTab(href);
  return (
    <NextLink
      {...props}
      href={targetHref}
      scroll={false}
      onNavigate={(event) => {
        // Re-selecting a tab keeps its reading position and does not refresh data.
        if (
          new URL(targetHref, window.location.href).href ===
          window.location.href
        ) {
          // A click back to the committed page also supersedes an in-flight route.
          if (!pendingHref) event.preventDefault();
          cancelNavigation();
          return;
        }
        prepareNavigation(targetHref);
        ticket.current = beginNavigation(targetHref);
      }}
    >
      <LinkPending ticket={ticket} />
      {children}
    </NextLink>
  );
}

function LinkPending({ ticket }: { ticket: React.RefObject<number | null> }) {
  const { pending } = useLinkStatus();
  const finish = useAppUI((s) => s.finishNavigation);
  const observed = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pending) observed.current = ticket.current;
    else if (observed.current !== null) {
      finish(observed.current);
      observed.current = null;
    }
  }, [pending, finish, ticket]);
  useEffect(
    () => () => {
      if (ticket.current !== null) finish(ticket.current);
    },
    [finish, ticket],
  );
  return null;
}

const links = [
  {
    label: "陪伴",
    href: "/companion",
    icon: MessageCircle,
    glyph: "companion",
  },
  { label: "直播", href: "/", icon: TvMinimalPlay, glyph: "live" },
  { label: "小说", href: "/novels", icon: BookOpen, glyph: "novels" },
  { label: "我的", href: "/me", icon: UserRound, glyph: "account" },
] satisfies {
  label: string;
  href: string;
  icon: typeof MessageCircle;
  glyph: NavigationGlyphName;
}[];

function StartupMobileLink(props: MobileNavigationLinkProps) {
  return <NextLink {...props} prefetch={false} />;
}

/** Account bootstrap has no business controllers and never pretends to be a guest. */
export function AppStartup() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => {
    try {
      setCollapsed(
        localStorage.getItem("radio-friday:sidebar-collapsed") === "true",
      );
    } catch {
      /* Optional layout preference. */
    }
  }, []);
  if (["/login", "/register", "/forgot-password"].includes(path))
    return (
      <div data-app-startup className="min-h-dvh bg-canvas text-ink">
        <LoadingPlaceholder label="正在加载账户…" className="min-h-dvh" />
      </div>
    );
  const liveRoom = /^\/live\/[^/]+$/.test(path);
  return (
    <div
      data-app-startup
      className="app-shell md:theme-graphite md:bg-canvas md:text-ink"
      data-nav-collapsed={collapsed}
      data-immersive={liveRoom}
    >
      <header className="site-nav text-ink" data-collapsed={collapsed}>
        <div className="site-brand">
          <span className="grid size-11 shrink-0 place-items-center">
            <RadioMark />
          </span>
          <span className="site-wordmark nav-collapse-label">Radio Friday</span>
        </div>
        <nav aria-label="主导航" className="primary-nav">
          {links.map(({ href, label, glyph }) => (
            <NextLink
              key={href}
              href={href}
              prefetch={false}
              aria-label={label}
              aria-current={(href === "/" ? path === "/" || path.startsWith("/live/") : path.startsWith(href)) ? "page" : undefined}
              className={cn(
                "nav-item",
                (href === "/" ? path === "/" || path.startsWith("/live/") : path.startsWith(href)) && "nav-item-active",
              )}
            >
              <NavigationGlyph name={glyph} />
              <span className="nav-collapse-label">{label}</span>
            </NextLink>
          ))}
        </nav>
        <div className="nav-footer">
          <div className="nav-identity-card">
            <SkeletonRegion
              kind="account-navigation"
              label="正在加载账户…"
              className="nav-identity-link pointer-events-none w-full"
            >
              <SkeletonBlock
                className={cn(
                  "shrink-0 rounded-full",
                  collapsed ? "size-8" : "size-10",
                )}
              />
              <div className="nav-collapse-label min-w-0 flex-1">
                <div className="flex h-5 items-center">
                  <SkeletonBlock className="h-3 w-20 max-w-full" />
                </div>
                <div className="mt-0.5 flex h-4 items-center">
                  <SkeletonBlock className="h-2.5 w-16 max-w-full" />
                </div>
              </div>
            </SkeletonRegion>
          </div>
        </div>
      </header>
      <div
        className={cn(
          "app-content md:min-h-dvh md:bg-canvas",
          !liveRoom && "relative isolate app-content-ambient",
        )}
      >
        {!liveRoom && <div aria-hidden="true" className="shell-ambient" />}
        <AccountStartupContent path={path} />
      </div>
      <MobileNavigation path={path} Link={StartupMobileLink} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useCurrentAccount();
  const path = usePathname();
  const cancelNavigation = useAppUI((s) => s.cancelNavigation);
  useLayoutEffect(() => {
    cancelNavigation();
  }, [path, cancelNavigation]);
  useEffect(() => {
    window.addEventListener("popstate", cancelNavigation);
    return () => window.removeEventListener("popstate", cancelNavigation);
  }, [cancelNavigation]);
  const isAuth = ["/login", "/register", "/forgot-password"].includes(path);
  // Keep the public boundary mounted even while auth is visible, so returning
  // home retains the outgoing page until AppFrame is ready. Auth stays outside:
  // its server-rendered form must not be hidden behind the account fallback.
  return (
    <AuthExitTransition>
      {isAuth ? children : null}
      <Suspense fallback={<AppStartup />}>
        {isAuth ? null : (
          <AppFrame user={user}>{children}</AppFrame>
        )}
      </Suspense>
    </AuthExitTransition>
  );
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
  const pendingHref = useAppUI((s) => s.pendingHref);
  const collapsed = useAppUI(appSelectors.collapsed);
  const hydrateSidebar = useAppUI((s) => s.hydrateSidebar);
  const toggleSidebar = useAppUI((s) => s.toggleSidebar);
  useLayoutEffect(() => {
    hydrateSidebar();
  }, [hydrateSidebar]);
  const immersive =
    path.startsWith("/chat/") ||
    /^\/live\/[^/]+$/.test(path) ||
    /^\/novels\/[^/]+\/chapters\/[^/]+$/.test(path) ||
    (path === "/operator" && !!params.get("id"));
  return (
    <BrowseNavigationProvider>
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
          {!immersive && <div aria-hidden="true" className="shell-ambient" />}
          <BrowsingPages user={user}>{children}</BrowsingPages>
        </div>
        <MobileNavigation path={path} pendingHref={pendingHref} Link={Link} />
      </div>
    </BrowseNavigationProvider>
  );
}

function NavigationTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const tooltip = useRef<HTMLSpanElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const hide = () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      tooltip.current?.hidePopover();
      anchor.current?.querySelector("a")?.removeAttribute("aria-describedby");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    hide();
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [enabled]);
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const link = anchor.current?.querySelector("a");
    const node = tooltip.current;
    if (!enabled || !link || !node) return;
    const bounds = link.getBoundingClientRect();
    node.style.left = `${bounds.right + 8}px`;
    node.style.top = `${Math.max(8, bounds.top + (bounds.height - 36) / 2)}px`;
    node.showPopover();
    link.setAttribute("aria-describedby", id);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    tooltip.current?.hidePopover();
    anchor.current?.querySelector("a")?.removeAttribute("aria-describedby");
  };
  return (
    <span
      ref={anchor}
      className="contents"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") show();
      }}
      onPointerLeave={() => {
        closeTimer.current = setTimeout(hide, 120);
      }}
      onFocus={show}
      onBlur={hide}
      onClick={hide}
    >
      {children}
      <span
        ref={tooltip}
        id={id}
        role="tooltip"
        popover="manual"
        className="fixed inset-auto m-0 min-h-9 rounded-control border border-line bg-panel px-3 py-2 text-xs font-medium text-ink shadow-popover"
      >
        {label}
      </span>
    </span>
  );
}

function NavigationLinks({
  path,
  desktop = false,
  showAccount = true,
  collapsed = false,
}: {
  path: string;
  desktop?: boolean;
  showAccount?: boolean;
  collapsed?: boolean;
}) {
  const pendingHref = useAppUI((s) => s.pendingHref);
  return links
    .filter((link) => showAccount || link.href !== "/me")
    .map(({ label, href, icon: Icon, glyph }) => {
      const active =
        (href === "/" ? path === "/" || path.startsWith("/live/") : path.startsWith(href)) ||
        (href === "/companion" && path.startsWith("/chat")) ||
        (href === "/me" &&
          (path === "/operator" || path === "/choose-identity"));
      return (
        <NavigationTooltip
          key={href}
          label={label}
          enabled={desktop && collapsed}
        >
          <Link
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            aria-busy={pendingHref?.split("?")[0] === href || undefined}
            data-pending={pendingHref?.split("?")[0] === href || undefined}
            className={cn(
              "nav-item",
              (pendingHref ? pendingHref.split("?")[0] === href : active) &&
                "nav-item-active",
            )}
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
        </NavigationTooltip>
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
  const itemClass =
    "flex min-h-14 items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

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
      if (
        openedByHover.current &&
        !panel.current?.contains(document.activeElement)
      ) {
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
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      const bounds = trigger.current?.getBoundingClientRect();
      const anchor = anchorPosition.current;
      if (
        bounds &&
        anchor &&
        (Math.abs(bounds.top - anchor.top) > 1 ||
          Math.abs(bounds.bottom - anchor.bottom) > 1)
      ) {
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

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget="account-navigation"
        aria-expanded={open}
        aria-controls="account-navigation"
        aria-label={label}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") openOnHover();
        }}
        onPointerLeave={closeOnLeave}
        onClick={(event) => {
          // A click after hover keeps the panel open; keyboard and touch also work.
          event.preventDefault();
          clearTimers();
          openedByHover.current = false;
          panel.current?.showPopover();
          panel.current
            ?.querySelector<HTMLAnchorElement>("a")
            ?.focus({ preventScroll: true });
        }}
        className={cn(
          "nav-identity-link group/account text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          !collapsed && "w-full aria-expanded:bg-surface-selected",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center rounded-full bg-surface-selected font-medium text-ink transition-colors group-hover/account:bg-surface-hover group-focus-visible/account:bg-surface-hover group-aria-expanded/account:bg-surface-hover",
            collapsed ? "size-8 text-xs" : "size-10 text-base",
          )}
        >
          {user.name?.slice(-1) || "我"}
        </span>
        <span className="nav-collapse-label min-w-0 flex-1">
          <span
            className="block truncate text-sm font-medium"
            title={user.name}
          >
            {user.name}
          </span>
          <span className="mt-0.5 block text-xs text-muted">账户与身份</span>
        </span>
      </button>
      <div
        ref={panel}
        id="account-navigation"
        popover="auto"
        role="navigation"
        aria-label="账户与身份"
        onBeforeToggle={(event) => {
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
        onToggle={(event) => {
          const expanded = event.newState === "open";
          setOpen(expanded);
        }}
        onPointerEnter={clearTimers}
        onPointerLeave={closeOnLeave}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          ) {
            panel.current?.hidePopover();
          }
        }}
        className="fixed inset-auto m-0 max-h-[calc(100dvh-2rem)] w-[300px] overflow-y-auto rounded-panel border border-line bg-panel p-2 text-ink shadow-popover"
      >
        <p className="px-3 pb-2 pt-3 text-xs font-medium text-muted">
          账户与身份
        </p>
        <Link
          href={user.inheritedIdentity ? "/operator" : "/choose-identity"}
          onClick={() => panel.current?.hidePopover()}
          className={itemClass}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-surface-soft">
            {user.inheritedIdentity ? (
              <Avatar identity={user.inheritedIdentity} />
            ) : (
              <Sparkles aria-hidden="true" className="size-5" />
            )}
          </span>
          <span className="min-w-0">
            <span
              className="block truncate text-sm font-medium"
              title={user.inheritedIdentity?.name}
            >
              {user.inheritedIdentity?.name ?? "拥有一个 AI 身份"}
            </span>
            <span className="mt-1 block text-xs text-muted">
              {user.inheritedIdentity
                ? "以此身份回复消息"
                : "以角色身份回复其他用户"}
            </span>
          </span>
        </Link>
        <div className="mx-3 my-2 border-t border-line" />
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            clearTimers();
            panel.current?.hidePopover();
            setNoticeOpen(true);
          }}
          className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Info aria-hidden="true" className="size-4" />
          平台互动说明
        </button>
        <form action={logoutAction}>
          <SubmitButton
            pendingLabel="正在退出…"
            className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-sm text-muted transition-colors enabled:hover:bg-surface-hover enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
          >
            <LogOut aria-hidden="true" className="size-4" />
            退出登录
          </SubmitButton>
        </form>
      </div>
      <InteractionNoticeDialog
        open={noticeOpen}
        onClose={() => setNoticeOpen(false)}
        returnFocusRef={trigger}
      />
    </>
  );
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
          href="/"
          aria-label="Radio Friday 首页"
          className="site-wordmark nav-collapse-label"
        >
          Radio Friday
        </Link>
      </div>
      <nav id="desktop-navigation" aria-label="主导航" className="primary-nav">
        <NavigationLinks
          path={path}
          desktop
          collapsed={collapsed}
          showAccount={!!user}
        />
      </nav>
      <div className="nav-footer">
        {user ? (
          <div className="nav-identity-card">
            <AccountMenu user={user} collapsed={collapsed} />
          </div>
        ) : (
          <>
            <Link
              href="/login"
              aria-label="登录 / 注册"
              title={collapsed ? "登录 / 注册" : undefined}
              className="nav-footer-row nav-auth-link"
            >
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center"
              >
                <LogIn className="size-5" strokeWidth={1.75} />
              </span>
              <span className="nav-collapse-label">登录 / 注册</span>
            </Link>
            <InteractionNoticeTrigger
              aria-label="平台互动说明"
              title={collapsed ? "平台互动说明" : undefined}
              className="nav-privacy"
            >
              <span aria-hidden="true" className="nav-privacy-icon">
                <Info className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="nav-collapse-label">平台互动说明</span>
            </InteractionNoticeTrigger>
          </>
        )}
      </div>
    </header>
  );
}
