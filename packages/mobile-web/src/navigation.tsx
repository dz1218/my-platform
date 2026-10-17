import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import { BookOpen, MessageCircle, Radio, UserRound } from 'lucide-react';

export type MobileNavigationLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode };
const tabs = [
  { href: '/companion', label: '陪伴', Icon: MessageCircle },
  { href: '/live', label: '直播', Icon: Radio },
  { href: '/novels', label: '小说', Icon: BookOpen },
  { href: '/me', label: '我的', Icon: UserRound },
] as const;

/** Routing and navigation cancellation stay in the web host. */
export function MobileNavigation({ path, pendingHref, Link }: {
  path: string;
  pendingHref?: string | null;
  Link: ComponentType<MobileNavigationLinkProps>;
}) {
  const pendingPath = pendingHref?.split('?')[0];
  return <nav aria-label="手机主导航" className="mobile-nav">
    {tabs.map(({ href, label, Icon }) => {
      const current = path.startsWith(href)
        || (href === '/companion' && path.startsWith('/chat/'))
        || (href === '/me' && (path === '/operator' || path === '/choose-identity'));
      const active = pendingPath ? pendingPath === href : current;
      return <Link key={href} href={href} aria-label={label} aria-current={current ? 'page' : undefined}
        aria-busy={pendingPath === href || undefined} data-pending={pendingPath === href || undefined}
        className={`nav-item group min-h-16 bg-transparent py-1.5 hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus ${active ? 'nav-item-active text-accent' : 'text-muted'}`}>
        <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors motion-reduce:transition-none ${active ? 'bg-accent-soft' : 'group-hover:bg-surface-soft'}`}>
          <Icon aria-hidden="true" className={`size-5 ${pendingPath === href ? 'motion-safe:animate-pulse' : ''}`} strokeWidth={active ? 2 : 1.75} />
        </span>
        <span className="text-xs leading-4">{label}</span>
      </Link>;
    })}
  </nav>;
}
