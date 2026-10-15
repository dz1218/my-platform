'use client';
import Link from 'next/link';
import { BookOpen, MessageCircle, TvMinimalPlay, UserRound } from 'lucide-react';
import { RadioMark } from './radio-mark';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { User } from '@/types/companion';

const links = [
  { label: '陪伴', href: '/companion', icon: MessageCircle },
  { label: '直播', href: '/live', icon: TvMinimalPlay },
  { label: '小说', href: '/novels', icon: BookOpen },
  { label: '我的', href: '/me', icon: UserRound },
];

export function AppShell({ children, user }: { children: ReactNode; user: User | null }) {
  const path = usePathname();
  if (path === '/login' || path === '/register') return children;
  return <div className="app-shell"><MainNav user={user} /><div className="app-content">{children}</div></div>;
}

export function MainNav({ user }: { user: User | null }) {
  const path = usePathname();
  return <header className="site-nav">
    <Link href="/companion" aria-label="Radio Friday 首页" className="site-brand">
      <RadioMark />
      <span>Radio Friday<span className="brand-caption">留一点时间给自己</span></span>
    </Link>
    <nav aria-label="主导航" className="primary-nav">{links.map(({ label, href, icon: Icon }) => {
      const active = path.startsWith(href) || href === '/companion' && path.startsWith('/chat');
      return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('nav-item', active && 'nav-item-active')}>
        <Icon aria-hidden="true" size={21} strokeWidth={1.75} />
        <span>{href === '/companion' && user?.inheritedIdentity ? '本账户' : label}</span>
      </Link>;
    })}</nav>
    <div className="nav-footer">
      {user && <div className="mb-6 border-b border-line pb-5">
        <p className="mb-2 text-xs text-muted">我的身份</p>
        <Link href="/companion" className="block py-2 text-sm hover:text-accent">本账户 · {user.name}</Link>
        {user.inheritedIdentity ? <Link href="/operator" aria-current={path.startsWith('/operator') ? 'page' : undefined} className={cn('block py-2 text-sm hover:text-accent', path.startsWith('/operator') && 'font-semibold text-accent')}>AI 身份 · {user.inheritedIdentity.name}</Link> : <Link href="/choose-identity" className="link-muted block py-2">选择 AI 身份</Link>}
      </div>}
      <p className="mb-3 text-sm text-ink">聊天、阅读，慢慢来。</p><Link href="/privacy" className="link-muted text-xs">平台互动说明</Link>
    </div>
  </header>;
}
