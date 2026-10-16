'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useAuthExit } from './auth-exit-transition';

export function AuthCloseButton() {
  const { closing, dismiss } = useAuthExit();
  return <Link href="/companion" replace prefetch
    aria-label="关闭并进入首页" title="关闭，先逛逛" aria-disabled={closing} aria-busy={closing}
    onNavigate={event => { event.preventDefault(); void dismiss(); }}
    className="absolute right-5 top-5 z-10 grid size-11 place-items-center rounded-full border border-photo-ink/20 bg-photo-shade/35 text-photo-ink backdrop-blur-sm transition-colors hover:bg-photo-shade/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus aria-disabled:cursor-wait">
    <X size={22} strokeWidth={1.75} aria-hidden="true" />
  </Link>;
}
