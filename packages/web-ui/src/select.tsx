'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

type Option = { value: string; label: string };

/** Shared themed picker. The native select only participates in form validation. */
export function Select({ id, label, options, value, onChange, placeholder = '请选择', searchPlaceholder, name, required = false, disabled = false, describedBy, requiredMessage = '请选择一项。' }: {
  id: string; label: string; options: Option[]; value: string; onChange: (value: string) => void;
  placeholder?: string; searchPlaceholder?: string; name?: string; required?: boolean;
  disabled?: boolean; describedBy?: string; requiredMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find(option => option.value === value);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const activeIndex = Math.min(active, filtered.length - 1);
  const activeId = open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  function position() {
    if (!trigger.current || !panel.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const below = viewportTop + viewportHeight - rect.bottom - 12;
    const above = rect.top - viewportTop - 12;
    const placeAbove = below < 240 && above > below;
    const maxHeight = Math.max(0, Math.min(352, placeAbove ? above : below));
    const width = Math.min(Math.max(rect.width, searchPlaceholder ? 260 : 0), viewportWidth - 24);
    panel.current.style.width = `${width}px`;
    panel.current.style.maxHeight = `${maxHeight}px`;
    panel.current.style.left = `${Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + viewportWidth - width - 12))}px`;
    panel.current.style.top = `${placeAbove ? rect.top - Math.min(panel.current.scrollHeight, maxHeight) - 6 : rect.bottom + 6}px`;
  }

  function close(restoreFocus = false) {
    panel.current?.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function expand(index = Math.max(0, options.findIndex(option => option.value === value))) {
    if (disabled) return;
    setQuery('');
    setActive(index);
    panel.current?.showPopover();
    setOpen(true);
  }

  function choose(option: Option | undefined) {
    if (!option || disabled) return;
    setInvalid(false);
    onChange(option.value);
    close(true);
  }

  useLayoutEffect(() => {
    if (open) position();
  });

  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const reposition = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      position();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !list.current || !activeId) return;
    const option = document.getElementById(activeId);
    if (!option) return;
    const bounds = option.getBoundingClientRect();
    const visible = list.current.getBoundingClientRect();
    if (bounds.top < visible.top) list.current.scrollTop -= visible.top - bounds.top;
    else if (bounds.bottom > visible.bottom) list.current.scrollTop += bounds.bottom - visible.bottom;
  }, [open, activeId, query]);

  useEffect(() => { if (disabled) close(); }, [disabled]);

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const searching = event.target === search.current;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!open) expand();
        else setActive(Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))));
        break;
      case 'Home':
      case 'End':
        if (searching) return;
        event.preventDefault();
        if (!open) expand(event.key === 'Home' ? 0 : options.length - 1);
        else setActive(event.key === 'Home' ? 0 : filtered.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (searching && event.key === ' ') return;
        event.preventDefault();
        if (open) choose(filtered[activeIndex]);
        else expand();
        break;
      case 'Escape':
        if (open) { event.preventDefault(); event.stopPropagation(); close(true); }
        break;
      case 'Tab':
        // Return to the trigger before the browser moves to the next form field.
        if (open) close(searching);
        break;
      default:
        if (!searching && event.key.length === 1) {
          const index = options.findIndex(option => option.label.startsWith(event.key));
          if (index >= 0) { event.preventDefault(); if (open) setActive(index); else choose(options[index]); }
        }
    }
  }

  return <div className="relative min-w-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    {name && <select name={name} required={required} disabled={disabled} value={value} tabIndex={-1} aria-hidden="true" className="sr-only"
      onChange={event => { onChange(event.target.value); setInvalid(false); }}
      onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>
      {!options.some(option => option.value === '') && <option value="" disabled>{placeholder}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>}
    <button ref={trigger} id={id} type="button" disabled={disabled} role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`}
      aria-activedescendant={searchPlaceholder ? undefined : activeId} aria-required={required || undefined}
      aria-invalid={invalid || undefined} aria-describedby={[describedBy, invalid ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined}
      className="input-field select-trigger" onClick={() => open ? close() : expand()} onKeyDown={handleKey}>
      <span className={`truncate ${selected ? '' : 'text-muted'}`}>{selected?.label ?? placeholder}</span>
      <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
    <div ref={panel} popover="auto" className="select-menu select-popover" onToggle={event => { if (event.newState === 'closed') setOpen(false); }}>
      {searchPlaceholder && <div className="relative shrink-0 border-b border-line p-2">
        <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted" />
        <input ref={search} type="search" aria-label={searchPlaceholder} aria-controls={`${id}-options`} aria-activedescendant={activeId}
          autoComplete="off" placeholder={searchPlaceholder} className="input-field pl-9" value={query}
          onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={handleKey} />
      </div>}
      <ul ref={list} id={`${id}-options`} role="listbox" aria-label={label} className="min-h-0 overflow-y-auto overscroll-contain p-1">
        {filtered.map((option, index) => <li key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={value === option.value}
          data-active={activeIndex === index} className="select-option gap-3" onPointerMove={() => setActive(index)}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <span className="min-w-0 break-words">{option.label}</span>
          {value === option.value && <Check aria-hidden="true" size={16} className="shrink-0" />}
        </li>)}
      </ul>
      {filtered.length === 0 && <p role="status" className="px-4 py-6 text-center text-sm text-muted">没有找到匹配的选项</p>}
    </div>
    {invalid && <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger">{requiredMessage}</p>}
  </div>;
}
