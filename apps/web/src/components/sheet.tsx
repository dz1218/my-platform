'use client';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

/** Native modal semantics provide focus trapping, Escape and focus restoration. */
export function Sheet({ open, onClose, title, children, fullHeight = false, desktopCentered = false, footer, className = '', returnFocusRef }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; fullHeight?: boolean;
  desktopCentered?: boolean; footer?: ReactNode; className?: string; returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.documentElement.style.overflow = overflow;
      const target = returnFocusRef?.current ?? previous;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open, returnFocusRef]);
  return <dialog ref={ref} aria-labelledby={titleId} className={`sheet ${fullHeight ? 'sheet-full' : ''} ${desktopCentered ? 'md:inset-0 md:m-auto md:w-[640px] md:max-w-[calc(100%-2rem)] md:max-h-[calc(100dvh-3rem)] md:rounded-panel' : ''} ${className}`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY > rect.bottom || event.clientX < rect.left || event.clientX > rect.right) onClose();
    }}>
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      <button type="button" autoFocus onClick={onClose} aria-label={`关闭${title}`} className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-soft"><X size={20} /></button>
    </header>
    {open && <div className="sheet-content min-h-0">{children}</div>}
    {open && footer && <footer className="shrink-0 border-t border-line px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))]">{footer}</footer>}
  </dialog>;
}
