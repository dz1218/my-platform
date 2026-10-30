"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Check, LoaderCircle, RotateCw } from "lucide-react";

type Phase =
  | "idle"
  | "pulling"
  | "refreshing"
  | "success"
  | "error"
  | "settling";
const threshold = 64;
const refreshDistance = 56;
const settleDuration = 280;

/** Gesture/animation state only. Data refresh and concurrency belong to the owner. */
export function MobilePullToRefresh({
  enabled,
  busy = false,
  onRefresh,
  label,
}: {
  enabled: boolean;
  busy?: boolean;
  onRefresh: () => Promise<unknown>;
  label: string;
}) {
  const latest = useRef({ busy, onRefresh });
  useLayoutEffect(() => {
    latest.current = { busy, onRefresh };
  });
  const [view, setView] = useState<{ phase: Phase; distance: number }>({
    phase: "idle",
    distance: 0,
  });
  const button = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const refresh = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!enabled) return;
    // Move the whole owning page, including headers above this component.
    const page = button.current?.closest("main");
    if (!page) return;
    content.current = page;
    setPortalReady(true);
    return () => {
      page.removeAttribute("data-pull-refresh-content");
      page.style.removeProperty("--pull-refresh-distance");
      content.current = null;
    };
  }, [enabled]);
  useLayoutEffect(() => {
    if (!enabled || !content.current) return;
    content.current.dataset.pullRefreshContent = view.phase;
    content.current.style.setProperty(
      "--pull-refresh-distance",
      `${view.distance}px`,
    );
  }, [enabled, view]);
  useEffect(() => {
    if (!enabled || !content.current) return;
    const page = content.current;
    let active = true;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gesture: {
      x: number;
      y: number;
      distance: number;
      captured: boolean;
    } | null = null;
    const root = document.documentElement;
    root.classList.add("has-pull-refresh");
    setView({ phase: "idle", distance: 0 });
    const idle = () => {
      gesture = null;
      if (running) return;
      clearTimeout(timer);
      setView({ phase: "settling", distance: 0 });
      timer = setTimeout(
        () => setView({ phase: "idle", distance: 0 }),
        settleDuration,
      );
    };
    const run = async () => {
      if (
        running ||
        latest.current.busy ||
        document.querySelector("dialog:modal, :popover-open")
      ) {
        idle();
        return;
      }
      clearTimeout(timer);
      running = true;
      setView({ phase: "refreshing", distance: refreshDistance });
      let phase: Phase = "success";
      try {
        await latest.current.onRefresh();
      } catch {
        phase = "error";
      }
      if (!active) return;
      running = false;
      setView({ phase, distance: refreshDistance });
      timer = setTimeout(idle, phase === "error" ? 1600 : 500);
    };
    refresh.current = () => {
      void run();
    };
    const start = (event: TouchEvent) => {
      if (gesture) idle();
      gesture = null;
      if (
        running ||
        latest.current.busy ||
        event.touches.length !== 1 ||
        window.scrollY > 1 ||
        document.querySelector("dialog:modal, :popover-open")
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        !page.contains(target) ||
        target.closest(
          'input, textarea, select, button, [contenteditable="true"], [data-no-pull-refresh]',
        )
      )
        return;
      for (
        let node: Element | null = target;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (
          node.scrollHeight > node.clientHeight + 1 &&
          /(auto|scroll)/.test(getComputedStyle(node).overflowY)
        )
          return;
      }
      const touch = event.touches[0];
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        distance: 0,
        captured: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (
        event.touches.length !== 1 ||
        latest.current.busy ||
        document.querySelector("dialog:modal, :popover-open") ||
        window.scrollY > 1
      ) {
        idle();
        return;
      }
      const dx = event.touches[0].clientX - gesture.x;
      const dy = event.touches[0].clientY - gesture.y;
      if (!gesture.captured) {
        if ((Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) || dy < -5) {
          idle();
          return;
        }
        if (dy < 10) return;
        if (!event.cancelable) {
          idle();
          return;
        }
        gesture.captured = true;
        clearTimeout(timer);
      }
      if (event.cancelable) event.preventDefault();
      gesture.distance = Math.min(112, Math.max(0, dy * 0.45));
      setView({ phase: "pulling", distance: gesture.distance });
    };
    const end = () => {
      if (!gesture) return;
      const ready = gesture.distance >= threshold;
      const captured = gesture.captured;
      gesture = null;
      if (ready) void run();
      else if (captured) idle();
    };
    const cancel = () => {
      if (gesture) idle();
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", cancel);
    return () => {
      active = false;
      clearTimeout(timer);
      refresh.current = () => {};
      root.classList.remove("has-pull-refresh");
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [enabled]);
  if (!enabled) return null;
  const text =
    view.phase === "refreshing"
      ? "正在刷新…"
      : view.phase === "success"
        ? "已更新"
        : view.phase === "error"
          ? "刷新失败，请重试"
          : view.distance >= threshold
            ? "松开刷新"
            : "下拉刷新";
  const Icon =
    view.phase === "refreshing"
      ? LoaderCircle
      : view.phase === "success"
        ? Check
        : view.phase === "error"
          ? RotateCw
          : ArrowDown;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label="刷新当前页面"
        title={`刷新${label}`}
        onClick={() => refresh.current()}
        disabled={busy || view.phase === "refreshing"}
        className="sr-only focus:not-sr-only focus:fixed focus:inset-x-5 focus:top-3 focus:z-40 focus:min-h-11 focus:rounded-control focus:bg-panel focus:text-ink"
      >
        刷新{label}
      </button>
      {portalReady &&
        createPortal(
          <div
            data-pull-refresh={view.phase}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-40 flex h-14 items-center justify-center text-muted motion-reduce:transition-none"
            style={{
              visibility: view.phase === "idle" ? "hidden" : "visible",
              transform: `translateY(${view.distance - refreshDistance}px)`,
              transition:
                view.phase === "pulling"
                  ? "none"
                  : `transform ${settleDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
            }}
          >
            <span className="flex items-center gap-2 text-xs">
              <Icon
                aria-hidden="true"
                className={`size-4 transition-transform duration-150 motion-reduce:transition-none ${view.phase === "refreshing" ? "motion-safe:animate-spin" : ""} ${view.phase === "pulling" && view.distance >= threshold ? "rotate-180" : ""}`}
              />
              {text}
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
