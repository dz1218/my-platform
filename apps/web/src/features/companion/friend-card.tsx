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
  const button = mobile ? 'flex min-h-11 w-full items-center gap-2 rounded-control py-2 text-sm font-medium text-accent transition-colors after:absolute after:inset-0 after:z-10 after:rounded-panel [&:not(:disabled):hover]:text-ink [&:not(:disabled):hover]:after:bg-surface-hover/20 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus' : 'btn-primary w-full';
  // Pending wins over pushed/cached matches, including the route-loading gap.
  if (known && !locked) return <MatchLink match={known} scroll={false} onNavigate={event => { if (!context.beginEntry(identity.id)) event.preventDefault(); }} className={mobile ? button : 'btn-secondary w-full'}><span>继续聊天<span className="sr-only">，和{identity.name}</span></span>{mobile && <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}</MatchLink>;
  return <button type="button" aria-label={known ? `继续聊天，和${identity.name}` : `和${identity.name}打个招呼`} disabled={!context.matchesReady || locked} aria-busy={pending} onClick={() => context.meet(identity.id)} className={`${mobile || !known ? button : 'btn-secondary w-full'} disabled:opacity-100 ${pending ? 'disabled:cursor-wait' : 'disabled:cursor-default'}`}>
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${pending ? 'text-muted' : ''}`}>
      <span>{pending ? '正在进入' : known ? '继续聊天' : '打个招呼'}</span>
      {pending ? <>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-3.5 shrink-0 motion-safe:animate-spin motion-safe:[animation-duration:900ms]">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.2" />
          <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </> : mobile && <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}
    </span>
  </button>;
}

export function MobileFriendCardAdapter({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  return <MobileFriendCard identity={identity} index={index} action={<FriendCardAction identity={identity} context={context} mobile />} />;
}

export function FriendCard({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  return <div className="p-2"><article data-identity-id={identity.id} data-identity-index={index} className="person-card gap-5">
    <div className="flex w-full items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-xl font-semibold">{identity.name}</h3><p className="mt-1 text-sm text-muted">{identity.age} 岁{identity.city ? `，${identity.city}` : ''}</p></div></div>
    {identity.occupation && <p className="text-sm font-medium text-accent">{identity.occupation}</p>}
    {identity.background && <p className="text-sm leading-7 text-muted">{identity.background}</p>}
    <FriendCardAction identity={identity} context={context} />
  </article></div>;
}

