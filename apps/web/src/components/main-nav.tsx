'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const links = [
  { label: '陪伴', href: '/companion', icon: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z' },
  { label: '直播', href: '/live', icon: 'M4 7h16v14H4z M8 3l4 4 4-4 M10 12l5 3-5 3z' },
  { label: '小说', href: '/novels', icon: 'M12 5v16 M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z' },
  { label: '我的', href: '/me', icon: 'M20 21v-2a7 7 0 0 0-14 0v2 M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === '/login' || path === '/register') return children;
  return <div className="app-shell"><MainNav /><div className="app-content">{children}</div></div>;
}

export function MainNav() {
  const path = usePathname();
  return <header className="site-nav">
    <Link href="/companion" aria-label="今晚首页" className="site-brand">
      <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-500 text-lg text-white">晚</span>
      <span>今晚<span className="brand-caption">留一点时间给自己</span></span>
    </Link>
    <nav aria-label="主导航" className="primary-nav">{links.map(({ label, href, icon }) => {
      const active = path.startsWith(href) || href === '/companion' && path.startsWith('/chat');
      return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('nav-item', active && 'nav-item-active')}>
        <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
        <span>{label}</span>
      </Link>;
    })}</nav>
    <div className="nav-footer"><p className="mb-3 text-sm text-ink">聊天、阅读，慢慢来。</p><Link href="/privacy" className="link-muted text-xs">平台互动说明</Link></div>
  </header>;
}
