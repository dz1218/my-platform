'use client';

import { useLayoutEffect, type RefObject } from 'react';

// Browser resources only: nested dialogs share one document lock and release it
// after the last modal closes. No account or application state lives here.
const locks = new WeakMap<Document, { dialogs: HTMLDialogElement[]; release: () => void }>();

function lockDialog(dialog: HTMLDialogElement) {
  const doc = dialog.ownerDocument;
  let lock = locks.get(doc);
  if (!lock) {
    const root = doc.documentElement;
    const body = doc.body;
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    const overscroll = root.style.overscrollBehavior;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    const dialogs: HTMLDialogElement[] = [];
    let previous: { x: number; y: number } | null = null;
    const canScroll = (target: EventTarget | null, dx: number, dy: number) => {
      const top = dialogs.at(-1);
      if (!top || !(target instanceof Element)) return false;
      // Select's native popover is portalled into the same browser top layer.
      const popover = target.closest<HTMLElement>(':popover-open');
      if (!top.contains(target) && !popover) return false;
      for (let node: Element | null = target; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const vertical = Math.abs(dy) >= Math.abs(dx);
        const overflow = vertical ? style.overflowY : style.overflowX;
        const offset = vertical ? node.scrollTop : node.scrollLeft;
        const limit = vertical ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
        const delta = vertical ? dy : dx;
        if (/(auto|scroll)/.test(overflow) && limit > 1 && (delta < 0 ? offset > 0 : offset < limit - 1)) return true;
        if (node === top || node === popover) break;
      }
      return false;
    };
    const start = (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      previous = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !previous) return;
      const touch = event.touches[0];
      const dx = previous.x - touch.clientX;
      const dy = previous.y - touch.clientY;
      previous = { x: touch.clientX, y: touch.clientY };
      if (!canScroll(event.target, dx, dy) && event.cancelable) event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !canScroll(event.target, event.deltaX, event.deltaY) && event.cancelable) event.preventDefault();
    };
    doc.addEventListener('touchstart', start, { passive: true, capture: true });
    doc.addEventListener('touchmove', move, { passive: false, capture: true });
    doc.addEventListener('wheel', wheel, { passive: false, capture: true });
    lock = { dialogs, release: () => {
      root.style.overflow = rootOverflow;
      body.style.overflow = bodyOverflow;
      root.style.overscrollBehavior = overscroll;
      doc.removeEventListener('touchstart', start, true);
      doc.removeEventListener('touchmove', move, true);
      doc.removeEventListener('wheel', wheel, true);
    } };
    locks.set(doc, lock);
  }
  lock.dialogs.push(dialog);
  return () => {
    const current = locks.get(doc);
    if (!current) return;
    const index = current.dialogs.indexOf(dialog);
    if (index >= 0) current.dialogs.splice(index, 1);
    if (!current.dialogs.length) {
      current.release();
      locks.delete(doc);
    }
  };
}

/** Tracks imperative showModal/close too; nonmodal desktop settings stay scrollable. */
export function useDialogScrollLock(ref: RefObject<HTMLDialogElement | null>) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    let release: (() => void) | undefined;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      if (!dialog.matches(':modal') || viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight;
      const bottom = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
      dialog.style.setProperty('--dialog-viewport-height', `${height}px`);
      dialog.style.setProperty('--dialog-keyboard-offset', `${bottom}px`);
    };
    const sync = () => {
      if (dialog.matches(':modal')) { release ??= lockDialog(dialog); updateViewport(); }
      else {
        release?.(); release = undefined;
        dialog.style.removeProperty('--dialog-viewport-height');
        dialog.style.removeProperty('--dialog-keyboard-offset');
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    dialog.addEventListener('close', sync);
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    sync();
    return () => {
      observer.disconnect(); dialog.removeEventListener('close', sync); release?.();
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      dialog.style.removeProperty('--dialog-viewport-height');
      dialog.style.removeProperty('--dialog-keyboard-offset');
    };
  }, [ref]);
}
