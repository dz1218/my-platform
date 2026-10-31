'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useStore } from 'zustand';
import { Select } from '@/components/select';
import { createCatalogFormStore, catalogSelectors } from '@/stores/catalog';
import { useStoreInstance } from '@/stores/use-store-instance';
import { emptyCatalogFilters, type CatalogFilters } from '@/services/catalog';

type Props = {
  value: CatalogFilters;
  occupations: Array<{ code: string; name: string }>;
  onChange: (value: CatalogFilters) => void;
  active?: boolean;
  disabled?: boolean;
  headingId?: string;
};

/** Desktop editor only. Applied filters remain owned by the companion controller. */
export function DiscoveryToolbar({ value, occupations, onChange, active = true, disabled = false, headingId }: Props) {
  const id = useId();
  const ui = useStoreInstance(() => createCatalogFormStore(value));
  const search = useStore(ui, catalogSelectors.search);
  const draft = useStore(ui, catalogSelectors.draft);
  const open = useStore(ui, catalogSelectors.open);
  const { setSearch, setDraft, resetDraft, prepareFilters, setOpen } = ui.getState();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const occupation = occupations.find(item => item.code === value.occupationCode)?.name;
  const hasFilters = Boolean(value.q || value.occupationCode || value.ageMin || value.ageMax);
  const filterCount = Number(Boolean(value.occupationCode)) + Number(Boolean(value.ageMin || value.ageMax));

  useEffect(() => { setSearch(value.q); }, [value.q, setSearch]);
  useEffect(() => { if (!active) panel.current?.hidePopover(); }, [active]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!panel.current || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 32);
      panel.current.style.width = `${width}px`;
      panel.current.style.left = `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`;
      panel.current.style.top = `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - panel.current.offsetHeight - 16))}px`;
      panel.current.style.maxHeight = `${window.innerHeight - 32}px`;
    };
    position();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      panel.current?.hidePopover();
    };
    window.addEventListener('resize', position);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const close = () => { panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); };
  const remove = (patch: Partial<CatalogFilters>) => {
    onChange({ ...value, ...patch });
    (patch.q !== undefined ? input.current : trigger.current)?.focus({ preventScroll: true });
  };

  return <div className="@container mb-5">
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <h2 id={headingId} className="flex min-h-11 shrink-0 items-center text-lg font-semibold tracking-tight">认识新朋友</h2>
      <div className="flex w-full min-w-0 items-center gap-2 @min-[560px]:w-auto">
      <form role="search" className="input-group flex min-w-0 flex-1 items-center @min-[560px]:w-72 @min-[560px]:flex-none" onSubmit={event => { event.preventDefault(); onChange({ ...value, q: search.trim() }); }}>
        <label htmlFor={`${id}-search`} className="sr-only">搜索名字</label>
        <button type="submit" disabled={disabled} aria-label="搜索朋友" className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:text-ink"><Search aria-hidden="true" className="size-4" /></button>
        <input ref={input} id={`${id}-search`} type="search" value={search} disabled={disabled} maxLength={80} autoComplete="off" placeholder="搜索名字" className="min-h-11 min-w-0 flex-1 bg-transparent pr-3 text-sm text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none" onChange={event => setSearch(event.target.value)} />
        {search && <button type="button" aria-label="清空名字" className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:text-ink" onClick={() => { setSearch(''); remove({ q: '' }); input.current?.focus(); }}><X aria-hidden="true" className="size-4" /></button>}
      </form>
      <button ref={trigger} type="button" disabled={disabled} popoverTarget={`${id}-filters`} aria-label={filterCount ? `筛选朋友，已应用 ${filterCount} 项` : '筛选朋友'} aria-expanded={open} aria-controls={`${id}-filters`} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border px-3 text-sm transition-colors hover:border-control hover:bg-surface-soft ${open || filterCount ? 'border-control bg-surface-selected text-ink' : 'border-line bg-panel text-muted'}`} onClick={() => { if (!open) setDraft(value); }}>
        <SlidersHorizontal aria-hidden="true" className="size-4" />筛选{filterCount > 0 && <span className="tabular-nums">{filterCount}</span>}
      </button>
      </div>
    </div>
    {hasFilters && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {value.q && <FilterChip label={`姓名：${value.q}`} onRemove={() => remove({ q: '' })} />}
      {value.occupationCode && <FilterChip label={occupation ?? value.occupationCode} onRemove={() => remove({ occupationCode: '' })} />}
      {(value.ageMin || value.ageMax) && <FilterChip label={`${value.ageMin || '18'}–${value.ageMax || '50'} 岁`} onRemove={() => remove({ ageMin: '', ageMax: '' })} />}
      <button type="button" className="ml-auto min-h-11 shrink-0 rounded-control px-1 hover:text-ink" onClick={() => { setSearch(''); onChange({ ...emptyCatalogFilters }); input.current?.focus({ preventScroll: true }); }}>清除全部</button>
    </div>}
    <div ref={panel} id={`${id}-filters`} popover="auto" aria-label="筛选朋友" className="fixed inset-auto m-0 overflow-y-auto rounded-panel border border-line bg-panel p-5 text-ink shadow-popover" onToggle={event => setOpen(event.newState === 'open')}>
      <form aria-label="筛选角色" onSubmit={event => {
        event.preventDefault();
        const next = prepareFilters();
        if (next) { onChange({ ...next, q: value.q }); close(); }
      }}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold">筛选朋友</h3><button type="button" aria-label="关闭筛选" className="-mr-2 grid size-11 place-items-center rounded-control text-muted hover:bg-surface-soft hover:text-ink" onClick={close}><X aria-hidden="true" className="size-4" /></button></div>
        <div className="grid gap-2"><label htmlFor={`${id}-occupation`} className="text-xs text-muted">职业</label><Select id={`${id}-occupation`} label="职业" searchPlaceholder="搜索职业" options={[{ value: '', label: '全部职业' }, ...occupations.map(item => ({ value: item.code, label: item.name }))]} value={draft.occupationCode} onChange={occupationCode => setDraft({ ...draft, occupationCode })} /></div>
        <fieldset className="mt-5"><legend className="mb-2 text-xs text-muted">年龄</legend><div className="flex items-center gap-2">
          <input aria-label="最小年龄" type="number" inputMode="numeric" min={18} max={50} step={1} placeholder="18" value={draft.ageMin} onChange={event => setDraft({ ...draft, ageMin: event.target.value })} className="input-field min-w-0 flex-1" />
          <span className="text-muted">至</span>
          <input aria-label="最大年龄" type="number" inputMode="numeric" min={draft.ageMin || 18} max={50} step={1} placeholder="50" value={draft.ageMax} onChange={event => setDraft({ ...draft, ageMax: event.target.value })} className="input-field min-w-0 flex-1" />
          <span className="text-xs text-muted">岁</span>
        </div></fieldset>
        <div className="mt-6 flex items-center justify-between gap-3"><button type="button" className="min-h-11 rounded-control px-2 text-sm text-muted hover:bg-surface-soft hover:text-ink" onClick={() => resetDraft(value.q)}>重置</button><button type="submit" className="btn-primary">应用筛选</button></div>
      </form>
    </div>
  </div>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button type="button" aria-label={`移除筛选：${label}`} onClick={onRemove} className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-2 hover:bg-surface-soft hover:text-ink"><span className="truncate">{label}</span><X aria-hidden="true" className="size-3 shrink-0" /></button>;
}

export function DiscoveryToolbarLoading() {
  return <DiscoveryToolbar value={emptyCatalogFilters} occupations={[]} onChange={() => {}} disabled />;
}
