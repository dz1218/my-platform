'use client';

import { useRef, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Search, X } from 'lucide-react';

export function NovelShelfSearch({ draft, onDraftChange, onSearch, total, searching, busy, disabled = false }: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSearch: (value: string) => void;
  total?: number;
  searching: boolean;
  busy: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!composing.current) onSearch(draft);
  }
  return <>
    <form role="search" aria-label="搜索书架" className="input-group flex w-full min-w-0 items-center border-line bg-panel focus-within:border-field-focus md:w-64 lg:w-72" onSubmit={submit}>
        <button type="submit" disabled={disabled} aria-label="搜索小说" className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:text-ink">{busy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : <Search aria-hidden="true" className="size-4" />}</button>
        <label htmlFor="novel-shelf-search" className="sr-only">搜索书名、作者或简介</label>
        <input ref={input} id="novel-shelf-search" type="search" maxLength={80} autoComplete="off" enterKeyHint="search" disabled={disabled} value={draft} placeholder="书名、作者或简介" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} onChange={event => onDraftChange(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent pr-3 text-base text-ink outline-none placeholder:text-muted md:text-sm [&::-webkit-search-cancel-button]:appearance-none" />
        {(draft || searching) && <button type="button" aria-label="清空搜索" disabled={disabled} className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:text-ink" onClick={() => { onSearch(''); input.current?.focus(); }}><X aria-hidden="true" className="size-4" /></button>}
    </form>
    <p role="status" className="sr-only">{busy ? '正在加载…' : total !== undefined ? `${searching ? '找到' : '共'} ${total} 本小说` : ''}</p>
  </>;
}

export function NovelShelfPagination({ page, pageCount, busy, onPageChange }: {
  page: number;
  pageCount?: number;
  busy: boolean;
  onPageChange: (page: number) => void;
}) {
  if (page === 1 && (pageCount ?? 1) <= 1) return null;
  const buttonClassName = 'inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-sm text-muted transition-colors enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-40';
  return <nav aria-label="书架分页" className="mt-8 flex items-center justify-between gap-2 border-t border-line pt-4 md:justify-end md:gap-4">
    <button type="button" aria-controls="novel-shelf-results" disabled={busy || page === 1} onClick={() => onPageChange(page - 1)} className={buttonClassName}><ChevronLeft aria-hidden="true" className="size-4" />上一页</button>
    <span role="status" className="text-xs tabular-nums text-muted">第 {page}{pageCount !== undefined ? ` / ${pageCount}` : ''} 页</span>
    <button type="button" aria-controls="novel-shelf-results" disabled={busy || pageCount === undefined || page >= pageCount} onClick={() => onPageChange(page + 1)} className={buttonClassName}>下一页<ChevronRight aria-hidden="true" className="size-4" /></button>
  </nav>;
}
