'use client';
import { useId, useState } from 'react';
import type { CatalogFilters as Filters } from '@/services/catalog';
import { Sheet } from '@/components/sheet';
import { SlidersHorizontal } from 'lucide-react';
import { useViewport } from '@/components/use-viewport';
import { emptyCatalogFilters } from '@/services/catalog';

type Props = { value: Filters; occupations: Array<{ code: string; name: string }>; onChange: (value: Filters) => void };
export function CatalogFilters({ value, occupations, onChange, sheet = false }: Props & { sheet?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  return <form aria-label="筛选角色" className="mb-5 grid grid-cols-2 gap-3 rounded-panel bg-panel p-4 sm:p-5 xl:grid-cols-4" onSubmit={event => {
    event.preventDefault();
    const next = { ...draft, q: draft.q.trim() };
    if (next.ageMin && next.ageMax && Number(next.ageMin) > Number(next.ageMax)) return;
    onChange(next);
  }}>
    {!sheet && <label htmlFor={`${id}-q`} className="col-span-2 grid gap-1.5 text-xs text-muted xl:col-span-1">姓名<input id={`${id}-q`} type="search" autoComplete="off" maxLength={80} placeholder="搜索名字" className="input-field" value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>}
    <label htmlFor={`${id}-occupation`} className="col-span-2 grid gap-1.5 text-xs text-muted xl:col-span-1">职业<select id={`${id}-occupation`} className="input-field" value={draft.occupationCode} onChange={event => setDraft({ ...draft, occupationCode: event.target.value })}><option value="">全部职业</option>{occupations.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    <label htmlFor={`${id}-min`} className="grid gap-1.5 text-xs text-muted">最小年龄<input id={`${id}-min`} className="input-field" type="number" min={18} max={50} placeholder="18" value={draft.ageMin} onChange={event => setDraft({ ...draft, ageMin: event.target.value })} /></label>
    <label htmlFor={`${id}-max`} className="grid gap-1.5 text-xs text-muted">最大年龄<input id={`${id}-max`} className="input-field" type="number" min={draft.ageMin || 18} max={50} placeholder="50" value={draft.ageMax} onChange={event => setDraft({ ...draft, ageMax: event.target.value })} /></label>
    <div className="col-span-2 flex gap-2 xl:col-span-4"><button className="btn-primary" type="submit">{sheet ? '应用' : '筛选'}</button><button className="btn-secondary" type="button" onClick={() => { const reset = sheet ? { ...emptyCatalogFilters, q: value.q } : emptyCatalogFilters; setDraft(reset); if (!sheet) onChange(reset); }}>重置</button></div>
  </form>;
}

export function MobileCatalogFilters({ value, occupations, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value.q);
  const count = [value.occupationCode, value.ageMin, value.ageMax].filter(Boolean).length;
  return <>
    <div className="mb-5 flex items-center gap-2">
      <form className="flex min-w-0 flex-1 gap-2" role="search" onSubmit={event => { event.preventDefault(); onChange({ ...value, q: search.trim() }); }}>
        <input aria-label="姓名" type="search" placeholder="搜索名字" value={search} maxLength={80} onChange={event => setSearch(event.target.value)} className="input-field min-w-0" />
        <button type="submit" className="btn-secondary shrink-0">搜索</button>
      </form>
      <button type="button" onClick={() => setOpen(true)} aria-label={`筛选朋友${count ? `，${count} 项条件` : ''}`} className="btn-secondary shrink-0 px-3"><SlidersHorizontal size={18} />{count || null}</button>
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title="筛选朋友">
      <CatalogFilters sheet value={value} occupations={occupations} onChange={next => { onChange(next); setOpen(false); }} />
    </Sheet>
  </>;
}

export function ResponsiveCatalogFilters(props: Props) {
  const viewport = useViewport();
  if (!viewport) return <div className="mb-5 h-12 rounded-control bg-surface-soft" />;
  return viewport === 'mobile' ? <MobileCatalogFilters {...props} /> : <CatalogFilters {...props} />;
}
