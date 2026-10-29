'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useStoreInstance } from '@my-platform/client-core/react';
import type { CatalogFilters } from '@my-platform/shared';
import { Select } from '@my-platform/web-ui/select';
import { Sheet } from '@my-platform/web-ui/sheet';
import { createMobileCatalogStore } from './stores/catalog';

type Props = { value: CatalogFilters; occupations: Array<{ code: string; name: string }>; onChange: (value: CatalogFilters) => void; anchored?: boolean; active?: boolean };

/** One frame for the loading and interactive search controls. */
function CatalogSearchBar({ search = '', count = 0, open = false, disabled = false, anchored = false, panelId, onSearch, onEdit, onClear, onFilter }: {
  search?: string; count?: number; open?: boolean; disabled?: boolean; anchored?: boolean; panelId?: string;
  onSearch?: () => void; onEdit?: (value: string) => void; onClear?: () => void; onFilter?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="flex items-center gap-2">
    <form role="search" className="flex min-w-0 flex-1 items-center rounded-full bg-surface-soft transition-colors focus-within:bg-surface-selected focus-within:ring-1 focus-within:ring-control" onSubmit={event => { event.preventDefault(); onSearch?.(); input.current?.blur(); }}>
      <button type="submit" disabled={disabled} aria-label="搜索" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-ink focus-visible:outline-offset-0"><Search aria-hidden="true" className="size-[18px]" /></button>
      {/* Only the outer frame is rounded; an input radius clips the caret at the text's start. */}
      <input ref={input} disabled={disabled} aria-label="姓名" type="search" enterKeyHint="search" autoComplete="off" placeholder="搜索名字" value={search} maxLength={80} onChange={event => onEdit?.(event.target.value)} className="h-11 min-w-0 w-full appearance-none rounded-none bg-transparent pr-3 pl-px text-base leading-6 text-ink caret-ink placeholder:text-muted focus:placeholder:text-transparent focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none" />
      {search && <button type="button" aria-label="清除搜索" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-ink focus-visible:outline-offset-0" onClick={() => { onClear?.(); input.current?.focus(); }}><X aria-hidden="true" className="size-4" /></button>}
    </form>
    <button id={panelId ? `${panelId}-trigger` : undefined} type="button" disabled={disabled} onClick={onFilter} aria-label={`筛选朋友${count ? `，${count} 项条件` : ''}`} aria-haspopup={anchored ? undefined : 'dialog'} aria-controls={anchored ? panelId : undefined} aria-expanded={open} className={`relative grid size-11 shrink-0 place-items-center rounded-full ${open || count ? 'bg-surface-selected text-ink' : 'bg-surface-soft text-muted hover:text-ink'}`}><SlidersHorizontal aria-hidden="true" className="size-[18px]" />{count > 0 && <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-action" />}</button>
  </div>;
}

export function MobileCatalogFilters({ value, occupations, onChange, anchored = false, active = true }: Props) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const store = useStoreInstance(() => createMobileCatalogStore(value));
  const { open, search, draft, error } = useStore(store, useShallow(state => ({ open: state.open, search: state.search, draft: state.draft, error: state.error })));
  const { editSearch, syncSearch, begin, cancel, edit, reset, apply, submitSearch, clearSearch } = store.getState();
  useEffect(() => syncSearch(value.q), [syncSearch, value.q]);
  useLayoutEffect(() => { if (!active) cancel(); }, [active, cancel]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!anchored || !element) return;
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return; }
    const position = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const y = Math.max(top + 8, bounds.bottom + 8);
      const panelWidth = Math.min(bounds.width, 288, width - 24);
      element.style.top = `${y}px`;
      element.style.left = `${Math.max(left + 12, bounds.right - panelWidth)}px`;
      element.style.width = `${panelWidth}px`;
      element.style.maxHeight = `${Math.max(80, top + height - y - 12)}px`;
    };
    element.showPopover();
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', cancel);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', cancel);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [anchored, open, cancel]);
  const count = [value.occupationCode, value.ageMin, value.ageMax].filter(Boolean).length;
  const occupation = occupations.find(item => item.code === value.occupationCode)?.name;
  const restoreTrigger = () => document.getElementById(`${id}-filters-trigger`)?.focus({ preventScroll: true });
  const ageInputClass = anchored ? 'h-11 w-full min-w-0 bg-transparent px-1 text-center text-base leading-6 text-ink caret-ink placeholder:text-muted focus:placeholder:text-transparent focus-visible:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' : 'input-field min-w-0 px-2 focus:placeholder:text-transparent';
  const fields = <form aria-label="筛选角色" className="grid grid-cols-2 gap-2" onSubmit={event => { event.preventDefault(); const next = apply(); if (next) { onChange(next); if (anchored) restoreTrigger(); } }}>
        <div className="col-span-2 grid gap-2 text-sm text-muted"><label htmlFor={`${id}-occupation`} className={anchored ? 'sr-only' : undefined}>职业</label><Select id={`${id}-occupation`} appearance={anchored ? 'quiet' : 'default'} label="职业" searchPlaceholder="搜索职业" value={draft.occupationCode} options={[{ value: '', label: '全部职业' }, ...occupations.map(item => ({ value: item.code, label: item.name }))]} onChange={occupationCode => edit({ occupationCode })} /></div>
        <fieldset className={`col-span-2 flex min-w-0 items-center gap-2 ${anchored ? 'rounded-control bg-surface-soft px-3 focus-within:ring-1 focus-within:ring-control' : ''}`}>
          <legend className="sr-only">年龄范围</legend><span aria-hidden="true" className="shrink-0 text-xs text-muted">年龄</span>
          <label htmlFor={`${id}-min`} className="min-w-0 flex-1"><span className="sr-only">最小年龄</span><input id={`${id}-min`} className={ageInputClass} type="number" inputMode="numeric" min={18} max={50} step={1} placeholder="18" value={draft.ageMin} aria-describedby={error ? `${id}-error` : undefined} onChange={event => edit({ ageMin: event.target.value })} /></label>
          <span aria-hidden="true" className="text-xs text-muted">—</span>
          <label htmlFor={`${id}-max`} className="min-w-0 flex-1"><span className="sr-only">最大年龄</span><input id={`${id}-max`} className={ageInputClass} type="number" inputMode="numeric" min={draft.ageMin || 18} max={50} step={1} placeholder="50" value={draft.ageMax} aria-describedby={error ? `${id}-error` : undefined} onChange={event => edit({ ageMax: event.target.value })} /></label>
        </fieldset>
        {error && <p id={`${id}-error`} role="alert" className="col-span-2 text-sm text-danger">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="min-h-11 rounded-control px-3 text-sm text-muted hover:bg-surface-soft hover:text-ink" onClick={reset}>重置</button><button type="submit" className={anchored ? 'btn-solid bg-ink px-5 text-canvas hover:bg-muted' : 'btn-primary px-4'}>应用</button></div>
      </form>;
  return <div className="mb-5">
    <div ref={anchor}><CatalogSearchBar search={search} count={count} open={open} anchored={anchored} panelId={`${id}-filters`} onSearch={() => onChange(submitSearch(value))} onEdit={editSearch} onClear={() => onChange(clearSearch(value))} onFilter={() => open ? cancel() : begin(value)} /></div>
    {!anchored && count > 0 && !open && <div className="mt-2 flex items-center gap-2 text-xs text-muted">
      <span className="min-w-0 flex-1 break-words">{[occupation, (value.ageMin || value.ageMax) && `${value.ageMin || 18}–${value.ageMax || 50} 岁`].filter(Boolean).join(' · ')}</span>
      <button type="button" className="flex min-h-11 shrink-0 items-center gap-1 rounded-control px-2 hover:bg-surface-soft hover:text-ink" onClick={() => onChange({ ...value, occupationCode: '', ageMin: '', ageMax: '' })}><X aria-hidden="true" className="size-3.5" />清除条件</button>
    </div>}
    {anchored ? <section ref={panel} id={`${id}-filters`} popover="auto" aria-label="筛选朋友" className="fixed inset-auto m-0 overflow-y-auto overscroll-contain rounded-panel border border-line bg-panel p-3 text-ink shadow-popover" onToggle={event => {
      // Select owns a nested popover; its close must not dismiss the filter panel.
      if (event.target !== event.currentTarget || event.newState !== 'closed' || !store.getState().open) return;
      cancel();
      if (event.currentTarget.contains(document.activeElement)) restoreTrigger();
    }}>{fields}</section> : <Sheet open={open} onClose={cancel} title="筛选朋友">{fields}</Sheet>}
  </div>;
}

export function MobileCatalogFiltersLoading() {
  return <div className="mb-5"><CatalogSearchBar disabled /></div>;
}
