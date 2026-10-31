'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronUp, LogOut, PhoneOff } from 'lucide-react';

/** Presentation only: the room owner still ends calls and releases media. */
export function LiveViewerLeave({ hasCall, disabled, endCallDisabled, onEndCall, onLeave }: {
  hasCall: boolean;
  disabled: boolean;
  endCallDisabled: boolean;
  onEndCall: () => void;
  onLeave: () => void;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const anchorPosition = useRef<DOMRect | null>(null);
  const [open, setOpen] = useState(false);

  function items() {
    return Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
  }

  function close(restoreFocus = false) {
    panel.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function expand(last = false) {
    if (disabled || !hasCall || !panel.current || !trigger.current) return;
    const menu = panel.current;
    menu.showPopover();
    const bounds = trigger.current.getBoundingClientRect();
    anchorPosition.current = bounds;
    const margin = 12;
    menu.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    const top = bounds.top - menu.offsetHeight - 8;
    menu.style.left = `${Math.max(margin, Math.min(bounds.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(top >= margin ? top : bounds.bottom + 8, window.innerHeight - menu.offsetHeight - margin))}px`;
    const enabled = items();
    (last ? enabled.at(-1) : enabled[0])?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!hasCall || disabled) close(!!panel.current?.contains(document.activeElement));
  }, [hasCall, disabled]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => close(!!panel.current?.contains(document.activeElement));
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      const bounds = trigger.current?.getBoundingClientRect();
      const anchor = anchorPosition.current;
      // Focusing the trigger can queue a scroll event before the menu opens.
      if (bounds && anchor && (Math.abs(bounds.top - anchor.top) > 1 || Math.abs(bounds.left - anchor.left) > 1)) dismiss();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = items();
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]?.focus({ preventScroll: true });
  }

  return <>
    <button
      ref={trigger}
      type="button"
      className="live-button live-button-leave"
      disabled={disabled}
      aria-haspopup={hasCall ? 'menu' : undefined}
      aria-expanded={hasCall ? open : undefined}
      aria-controls={hasCall ? menuId : undefined}
      onClick={() => hasCall ? open ? close(true) : expand() : onLeave()}
      onKeyDown={event => {
        if (hasCall && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          expand(event.key === 'ArrowUp');
        }
      }}
    >
      {!hasCall && <LogOut aria-hidden="true" size={17} />}{hasCall ? '退出' : '退出房间'}
      {hasCall && <ChevronUp aria-hidden="true" size={15} className={open ? 'rotate-180' : ''} />}
    </button>
    <div
      ref={panel}
      id={menuId}
      popover="auto"
      role="menu"
      aria-label="离开选项"
      className="fixed inset-auto m-0 w-60 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-panel border border-line bg-panel p-1.5 text-ink shadow-popover"
      onToggle={event => setOpen(event.newState === 'open')}
      onKeyDown={handleMenuKey}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close();
      }}
    >
      <button type="button" role="menuitem" aria-label="退出连麦" disabled={endCallDisabled} onClick={() => { close(true); onEndCall(); }} className="flex min-h-18 w-full items-center gap-3 rounded-control px-3 py-3 text-left hover:bg-surface-hover focus-visible:outline-offset-0">
        <PhoneOff aria-hidden="true" size={18} className="shrink-0 text-muted" />
        <span><span className="block text-sm font-medium">退出连麦</span><span className="mt-1 block text-xs text-muted">留在直播间，继续观看</span></span>
      </button>
      <button type="button" role="menuitem" aria-label="退出房间" disabled={disabled} onClick={() => { close(true); onLeave(); }} className="flex min-h-18 w-full items-center gap-3 rounded-control px-3 py-3 text-left hover:bg-danger-soft focus-visible:outline-offset-0">
        <LogOut aria-hidden="true" size={18} className="shrink-0 text-danger" />
        <span><span className="block text-sm font-medium text-danger">退出房间</span><span className="mt-1 block text-xs text-muted">退出当前直播间</span></span>
      </button>
    </div>
  </>;
}
