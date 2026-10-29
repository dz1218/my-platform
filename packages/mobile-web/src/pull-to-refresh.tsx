"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Check, LoaderCircle, RotateCw } from "lucide-react";

type Phase = "idle" | "pulling" | "refreshing" | "success" | "error";
const threshold = 64;

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
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) return;
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
      if (!running) setView({ phase: "idle", distance: 0 });
    };
    const run = async () => {
      if (
        running ||
        latest.current.busy ||
        document.querySelector("dialog:modal")
      )
        return;
      clearTimeout(timer);
      running = true;
      setView({ phase: "refreshing", distance: threshold });
      let phase: Phase = "success";
      try {
        await latest.current.onRefresh();
      } catch {
        phase = "error";
      }
      if (!active) return;
      running = false;
      setView({ phase, distance: threshold });
      timer = setTimeout(idle, phase === "error" ? 3500 : 1000);
    };
    refresh.current = () => {
      void run();
    };
    const start = (event: TouchEvent) => {
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
        !target?.closest("main") ||
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
      clearTimeout(timer);
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
        document.querySelector("dialog:modal") ||
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
      }
      if (event.cancelable) event.preventDefault();
      gesture.distance = Math.min(96, Math.max(0, dy * 0.45));
      setView({ phase: "pulling", distance: gesture.distance });
    };
    const end = () => {
      const ready = gesture && gesture.distance >= threshold;
      gesture = null;
      if (ready) void run();
      else if (!running) idle();
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", idle);
    return () => {
      active = false;
      clearTimeout(timer);
      refresh.current = () => {};
      root.classList.remove("has-pull-refresh");
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", idle);
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
        type="button"
        aria-label="刷新当前页面"
        title={`刷新${label}`}
        onClick={() => refresh.current()}
        disabled={busy || view.phase === "refreshing"}
        className="sr-only focus:not-sr-only focus:fixed focus:inset-x-5 focus:top-3 focus:z-40 focus:min-h-11 focus:rounded-control focus:bg-panel focus:text-ink"
      >
        刷新{label}
      </button>
      <div
        data-pull-refresh={view.phase}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-40 flex justify-center"
        style={{
          visibility: view.phase === "idle" ? "hidden" : "visible",
          transform: `translateY(${view.distance - 48}px)`,
        }}
      >
        <span className="flex h-11 items-center gap-2 rounded-full border border-line bg-panel px-4 text-xs text-ink shadow-popover">
          <Icon
            aria-hidden="true"
            className={`size-4 ${view.phase === "refreshing" ? "motion-safe:animate-spin" : ""}`}
          />
          {text}
        </span>
      </div>
    </>
  );
}
