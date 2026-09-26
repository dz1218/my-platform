'use client';
import { useEffect, useRef } from 'react';

/** Protect an editor's draft when leaving via a link, refresh or tab close. */
export function UnsavedChanges() {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    let dirty = false;
    const change = () => { dirty = true; };
    const submit = () => { dirty = false; };
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const navigate = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || link.getAttribute('target') === '_blank' || link.getAttribute('href')?.startsWith('#')) return;
      if (!window.confirm('还有未保存的修改，确定离开吗？')) { event.preventDefault(); event.stopPropagation(); }
    };
    form.addEventListener('input', change);
    form.addEventListener('submit', submit);
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      form.removeEventListener('input', change);
      form.removeEventListener('submit', submit);
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, []);
  return <span ref={anchor} hidden />;
}
