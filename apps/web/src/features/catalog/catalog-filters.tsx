'use client';
import { useId } from 'react';
import { useStore } from 'zustand';
import { createCatalogFormStore, catalogSelectors } from '@/stores/catalog';
import { useStoreInstance } from '@/stores/use-store-instance';
import type { CatalogFilters as Filters } from '@/services/catalog';
import { Select } from '@/components/select';
import { useViewport } from '@/components/use-viewport';
import { MobileCatalogFilters, MobileCatalogFiltersLoading } from '@my-platform/mobile-web/catalog';
export { MobileCatalogFilters } from '@my-platform/mobile-web/catalog';

type Props = { value: Filters; occupations: Array<{ code: string; name: string }>; onChange: (value: Filters) => void; compact?: boolean };
export function CatalogFilters({ value, occupations, onChange, sheet = false, compact = false }: Props & { sheet?: boolean }) {
  const id = useId();
  const ui = useStoreInstance(() => createCatalogFormStore(value));
  const draft = useStore(ui, catalogSelectors.draft);
  const { setDraft, resetDraft, prepareFilters } = ui.getState();
  return <form aria-label="筛选角色" className={`mb-5 grid grid-cols-2 gap-3 ${compact ? 'items-end border-b border-line pb-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_80px_80px_auto]' : 'rounded-panel bg-panel p-4 sm:p-5 xl:grid-cols-4'}`} onSubmit={event => {
    event.preventDefault();
    const next = prepareFilters();
    if (next) onChange(next);
  }}>
    <CatalogFilterFields id={id} draft={draft} occupations={occupations} onDraftChange={setDraft} sheet={sheet} />
    <div className={`col-span-2 flex gap-2 ${compact ? 'xl:col-span-1' : 'xl:col-span-4'}`}><button className="btn-primary" type="submit">{sheet ? '应用' : '筛选'}</button><button className={compact ? 'min-h-11 rounded-control px-3 text-sm text-muted hover:bg-surface-soft hover:text-ink' : 'btn-secondary'} type="button" onClick={() => { const reset = resetDraft(sheet ? value.q : ''); if (!sheet) onChange(reset); }}>重置</button></div>
  </form>;
}

export function ResponsiveCatalogFilters(props: Props) {
  const viewport = useViewport();
  if (!viewport) return <div className="mb-5 h-12 rounded-control bg-surface-soft" />;
  return viewport === 'mobile' ? <MobileCatalogFilters {...props} /> : <CatalogFilters {...props} />;
}

function CatalogFilterFields({ id, draft, occupations, onDraftChange, sheet = false, disabled = false }: {
  id: string; draft: Filters; occupations: Props['occupations']; onDraftChange: (value: Filters) => void; sheet?: boolean; disabled?: boolean;
}) {
  return <>
    {!sheet && <label htmlFor={`${id}-q`} className="col-span-2 grid gap-1.5 text-xs text-muted xl:col-span-1">姓名<input id={`${id}-q`} disabled={disabled} type="search" autoComplete="off" maxLength={80} placeholder="搜索名字" className="input-field" value={draft.q} onChange={event => onDraftChange({ ...draft, q: event.target.value })} /></label>}
    <div className="col-span-2 grid min-w-0 gap-1.5 text-xs text-muted xl:col-span-1"><label htmlFor={`${id}-occupation`}>职业</label><Select disabled={disabled} id={`${id}-occupation`} label="职业" searchPlaceholder="搜索职业" value={draft.occupationCode} options={[{ value: '', label: '全部职业' }, ...occupations.map(item => ({ value: item.code, label: item.name }))]} onChange={occupationCode => onDraftChange({ ...draft, occupationCode })} /></div>
    <label htmlFor={`${id}-min`} className="grid gap-1.5 text-xs text-muted">最小年龄<input id={`${id}-min`} className="input-field" disabled={disabled} type="number" min={18} max={50} placeholder="18" value={draft.ageMin} onChange={event => onDraftChange({ ...draft, ageMin: event.target.value })} /></label>
    <label htmlFor={`${id}-max`} className="grid gap-1.5 text-xs text-muted">最大年龄<input id={`${id}-max`} className="input-field" disabled={disabled} type="number" min={draft.ageMin || 18} max={50} placeholder="50" value={draft.ageMax} onChange={event => onDraftChange({ ...draft, ageMax: event.target.value })} /></label>
  </>;
}

/** Disabled controls preserve the directory layout before account/viewport resolution. */
export function CatalogFiltersLoading({ mobile = false }: { mobile?: boolean }) {
  const id = useId();
  if (mobile) return <MobileCatalogFiltersLoading />;
  return <div aria-label="筛选角色" className="mb-5 grid grid-cols-2 gap-3 rounded-panel bg-panel p-4 sm:p-5 xl:grid-cols-4">
    <CatalogFilterFields id={id} draft={{ q: '', occupationCode: '', ageMin: '', ageMax: '' }} occupations={[]} onDraftChange={() => {}} disabled />
    <div className="col-span-2 flex gap-2 xl:col-span-4"><button disabled type="button" className="btn-primary">筛选</button><button disabled type="button" className="btn-secondary">重置</button></div>
  </div>;
}
