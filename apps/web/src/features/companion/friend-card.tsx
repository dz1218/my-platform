import { MatchLink } from '@/features/chat/match-link';
import { Avatar } from '@/features/identity/avatar';
import type { Identity } from '@/types/companion';
import type { CardContext } from './use-companion-home';
import { MobileFriendCard } from '@my-platform/mobile-web/companion';
import { ArrowUpRight } from 'lucide-react';

function FriendCardAction({ identity, context, mobile = false }: { identity: Identity; context: CardContext; mobile?: boolean }) {
  const known = context.known.get(identity.id);
  const pending = context.pendingIds.includes(identity.id) || context.enteringId === identity.id;
  const locked = context.pendingIds.length > 0 || context.enteringId !== null;
  // The stretched hit area keeps a single native link/button and one tab stop per card.
  const desktopButton = 'flex min-h-11 w-full items-center gap-2 rounded-control text-sm font-medium text-ink after:absolute after:inset-0 after:z-10 after:rounded-panel focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus';
  const button = mobile ? 'flex min-h-11 w-full items-center gap-2 rounded-control py-2 text-sm font-medium text-accent transition-colors after:absolute after:inset-0 after:z-10 after:rounded-panel [&:not(:disabled):hover]:text-ink [&:not(:disabled):hover]:after:bg-surface-hover/20 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus' : desktopButton;
  // Pending wins over pushed/cached matches, including the route-loading gap.
  if (known && !locked) return <MatchLink match={known} scroll={false} className={button}><span>继续聊天<span className="sr-only">，和{identity.name}</span></span><ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></MatchLink>;
  return <button type="button" aria-label={known ? `继续聊天，和${identity.name}` : `和${identity.name}打个招呼`} disabled={!context.matchesReady || locked} aria-busy={pending} onClick={() => context.meet(identity.id)} className={`${button} disabled:opacity-100 ${pending ? 'disabled:cursor-wait' : 'disabled:cursor-default'}`}>
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${pending ? 'text-muted' : ''}`}>
      <span>{pending ? '正在进入' : known ? '继续聊天' : '打个招呼'}</span>
      {pending ? <>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-3.5 shrink-0 motion-safe:animate-spin motion-safe:[animation-duration:900ms]">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.2" />
          <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </> : <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}
    </span>
  </button>;
}

export function MobileFriendCardAdapter({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  return <MobileFriendCard identity={identity} index={index} action={<FriendCardAction identity={identity} context={context} mobile />} />;
}

export function FriendCard({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  const opening = `在${identity.city}生活，是一名${identity.occupation}。`;
  const background = identity.background?.startsWith(opening) ? identity.background.slice(opening.length) : identity.background;
  return <div className="px-2 pb-4"><article data-identity-id={identity.id} data-identity-index={index} className="relative flex h-64 min-w-0 flex-col rounded-panel border border-line/60 bg-panel p-5 transition-shadow duration-200 hover:shadow-card-hover">
    <div className="flex w-full items-center gap-3 [&>div:first-child]:bg-surface-soft [&>div:first-child]:text-ink"><Avatar identity={identity} /><div className="min-w-0 flex-1"><h3 className="truncate text-base font-semibold">{identity.name}</h3><p className="mt-1 text-xs text-muted">{identity.age} 岁{identity.city ? ` · ${identity.city}` : ''}</p></div></div>
    {identity.occupation && <p className="mt-5 truncate text-sm font-medium text-ink">{identity.occupation}</p>}
    {background && <p className="mt-2 line-clamp-3 break-words text-[15px] leading-6 text-ink/80">{background}</p>}
    <div className="mt-auto pt-2"><FriendCardAction identity={identity} context={context} /></div>
  </article></div>;
}

