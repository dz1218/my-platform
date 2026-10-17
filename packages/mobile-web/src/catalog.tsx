'use client';

import { useEffect, useId } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useStoreInstance } from '@my-platform/client-core/react';
import type { CatalogFilters } from '@my-platform/shared';
import { Select } from '@my-platform/web-ui/select';
import { Sheet } from '@my-platform/web-ui/sheet';
import { createMobileCatalogStore } from './stores/catalog';

type Props = { value: CatalogFilters; occupations: Array<{ code: string; name: string }>; onChange: (value: CatalogFilters) => void };

export function MobileCatalogFilters({ value, occupations, onChange }: Props) {
  const id = useId();
  const store = useStoreInstance(() => createMobileCatalogStore(value));
  const { open, search, draft, error } = useStore(store, useShallow(state => ({ open: state.open, search: state.search, draft: state.draft, error: state.error })));
  const { editSearch, syncSearch, begin, cancel, edit, reset, apply, submitSearch } = store.getState();
  useEffect(() => syncSearch(value.q), [syncSearch, value.q]);
  const count = [value.occupationCode, value.ageMin, value.ageMax].filter(Boolean).length;
  const occupation = occupations.find(item => item.code === value.occupationCode)?.name;
  return <div className="mb-2">
    <div className="flex items-center gap-2">
      <form role="search" className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-panel py-1 pr-1 pl-3" onSubmit={event => { event.preventDefault(); onChange(submitSearch(value)); }}>
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <input aria-label="姓名" type="search" placeholder="搜索名字" value={search} maxLength={80} onChange={event => editSearch(event.target.value)} className="min-h-11 min-w-0 w-full rounded-control bg-transparent px-2 text-base text-ink placeholder:text-muted focus-visible:outline-offset-0" />
        <button type="submit" className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium text-accent hover:bg-surface-soft">搜索</button>
      </form>
      <button type="button" onClick={() => begin(value)} aria-label={`筛选朋友${count ? `，${count} 项条件` : ''}`} aria-haspopup="dialog" className={`flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 ${count ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-panel text-muted hover:text-ink'}`}><SlidersHorizontal aria-hidden="true" className="size-4" />{count || null}</button>
    </div>
    {(value.q || count > 0) && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="py-2">{[value.q && `姓名：${value.q}`, occupation, (value.ageMin || value.ageMax) && `${value.ageMin || 18}–${value.ageMax || 50} 岁`].filter(Boolean).join(' / ')}</span>
      <button type="button" className="ml-auto flex min-h-11 items-center gap-1 rounded-control px-2 hover:bg-surface-soft hover:text-ink" onClick={() => { editSearch(''); onChange({ q: '', occupationCode: '', ageMin: '', ageMax: '' }); }}><X aria-hidden="true" className="size-3.5" />清除条件</button>
    </div>}
    <Sheet open={open} onClose={cancel} title="筛选朋友">
      <form aria-label="筛选角色" className="grid grid-cols-2 gap-5" onSubmit={event => { event.preventDefault(); const next = apply(); if (next) onChange(next); }}>
        <div className="col-span-2 grid gap-2 text-sm text-muted"><label htmlFor={`${id}-occupation`}>职业</label><Select id={`${id}-occupation`} label="职业" searchPlaceholder="搜索职业" value={draft.occupationCode} options={[{ value: '', label: '全部职业' }, ...occupations.map(item => ({ value: item.code, label: item.name }))]} onChange={occupationCode => edit({ occupationCode })} /></div>
        <label htmlFor={`${id}-min`} className="grid gap-2 text-sm text-muted">最小年龄<input id={`${id}-min`} className="input-field" type="number" inputMode="numeric" min={18} max={50} step={1} placeholder="18" value={draft.ageMin} aria-describedby={error ? `${id}-error` : undefined} onChange={event => edit({ ageMin: event.target.value })} /></label>
        <label htmlFor={`${id}-max`} className="grid gap-2 text-sm text-muted">最大年龄<input id={`${id}-max`} className="input-field" type="number" inputMode="numeric" min={draft.ageMin || 18} max={50} step={1} placeholder="50" value={draft.ageMax} aria-describedby={error ? `${id}-error` : undefined} onChange={event => edit({ ageMax: event.target.value })} /></label>
        {error && <p id={`${id}-error`} role="alert" className="col-span-2 text-sm text-danger">{error}</p>}
        <div className="col-span-2 mt-2 flex gap-3"><button type="button" className="btn-secondary flex-1" onClick={reset}>重置</button><button type="submit" className="btn-primary flex-1">应用</button></div>
      </form>
    </Sheet>
  </div>;
}

export function MobileCatalogFiltersLoading() {
  return <div className="mb-2 flex items-center gap-2"><div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-panel py-1 pr-1 pl-3"><Search aria-hidden="true" className="size-4 shrink-0 text-muted" /><input disabled aria-label="姓名" type="search" placeholder="搜索名字" className="min-h-11 min-w-0 w-full bg-transparent px-2 text-base" /><button disabled type="button" className="min-h-11 px-3 text-sm text-muted">搜索</button></div><button disabled type="button" aria-label="筛选朋友" className="grid size-12 shrink-0 place-items-center rounded-full border border-line text-muted"><SlidersHorizontal aria-hidden="true" className="size-4" /></button></div>;
}
