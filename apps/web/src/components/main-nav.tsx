'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function MainNav() {
  const path = usePathname();
  if (path === '/login' || path === '/register') return null;
  return <nav aria-label="主导航" className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
    <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
      <Link href="/companion" className="text-lg font-semibold tracking-widest text-rose-100">今晚</Link>
      <div className="flex gap-5 text-sm">{[['陪伴', '/companion'], ['直播', '/live'], ['小说', '/novels'], ['我的', '/me']].map(([label, href]) => <Link key={href} href={href} aria-current={path.startsWith(href) || href === '/companion' && path.startsWith('/chat') ? 'page' : undefined} className="text-slate-400 transition-colors hover:text-white aria-[current=page]:text-rose-200">{label}</Link>)}</div>
    </div>
  </nav>;
}
