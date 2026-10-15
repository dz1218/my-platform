'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal semantics provide focus trapping, Escape and focus restoration. */
export function Sheet({ open, onClose, title, children, fullHeight = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; fullHeight?: boolean;
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
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} className={`sheet ${fullHeight ? 'sheet-full' : ''}`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) onClose();
    }}>
    <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      <button type="button" autoFocus onClick={onClose} aria-label={`关闭${title}`} className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-soft"><X size={20} /></button>
    </header>
    {open && <div className="sheet-content">{children}</div>}
  </dialog>;
}
