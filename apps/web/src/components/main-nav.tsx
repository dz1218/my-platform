'use client';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { usePathname } from 'next/navigation';
const links = [['陪伴', '/companion'], ['直播', '/live'], ['小说', '/novels'], ['我的', '/me']];
export function MainNav() {
  const path = usePathname();
  if (path === '/login' || path === '/register') return null;
  return <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
    <div className="page-shell flex h-[60px] items-center justify-between gap-4">
      <Link href="/companion" aria-label="今晚首页" className="flex items-center shrink-0 gap-2.5 text-lg font-semibold text-ink">
        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-brand-500 text-sm text-white">晚</span>今晚
      </Link>
      <nav aria-label="主导航" className="flex h-full gap-3 text-sm sm:gap-6">{links.map(([label, href]) => {
        const active = path.startsWith(href) || href === '/companion' && path.startsWith('/chat');
        return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex items-center border-b-2 px-1 transition-colors', active ? 'border-brand-500 font-medium text-brand-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900')}>{label}</Link>;
      })}</nav>
    </div>
  </header>;
}
