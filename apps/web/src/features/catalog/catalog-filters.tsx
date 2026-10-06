'use client';
import { useId, useState } from 'react';
import type { CatalogFilters as Filters } from '@/services/catalog';
import { emptyCatalogFilters } from '@/services/catalog';

export function CatalogFilters({ value, occupations, onChange }: {
  value: Filters; occupations: Array<{ code: string; name: string }>; onChange: (value: Filters) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  return <form aria-label="筛选角色" className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" onSubmit={event => {
    event.preventDefault();
    const next = { ...draft, q: draft.q.trim() };
    if (next.ageMin && next.ageMax && Number(next.ageMin) > Number(next.ageMax)) return;
    onChange(next);
  }}>
    <label htmlFor={`${id}-q`} className="col-span-2 grid gap-1.5 text-xs text-muted xl:col-span-1">姓名<input id={`${id}-q`} type="search" autoComplete="off" maxLength={80} placeholder="搜索名字" className="input-field" value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
    <label htmlFor={`${id}-occupation`} className="col-span-2 grid gap-1.5 text-xs text-muted xl:col-span-1">职业<select id={`${id}-occupation`} className="input-field" value={draft.occupationCode} onChange={event => setDraft({ ...draft, occupationCode: event.target.value })}><option value="">全部职业</option>{occupations.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    <label htmlFor={`${id}-min`} className="grid gap-1.5 text-xs text-muted">最小年龄<input id={`${id}-min`} className="input-field" type="number" min={18} max={50} placeholder="18" value={draft.ageMin} onChange={event => setDraft({ ...draft, ageMin: event.target.value })} /></label>
    <label htmlFor={`${id}-max`} className="grid gap-1.5 text-xs text-muted">最大年龄<input id={`${id}-max`} className="input-field" type="number" min={draft.ageMin || 18} max={50} placeholder="50" value={draft.ageMax} onChange={event => setDraft({ ...draft, ageMax: event.target.value })} /></label>
    <div className="col-span-2 flex gap-2 xl:col-span-4"><button className="btn-secondary" type="submit">筛选</button><button className="btn-secondary" type="button" onClick={() => { setDraft(emptyCatalogFilters); onChange(emptyCatalogFilters); }}>重置</button></div>
  </form>;
}
