import { MatchLink } from '@/features/chat/match-link';
import { Avatar } from '@/features/identity/avatar';
import type { Identity } from '@/types/companion';
import type { CardContext } from './use-companion-home';
import { MobileFriendCard } from '@my-platform/mobile-web/companion';

function FriendCardAction({ identity, context, fullWidth = false }: { identity: Identity; context: CardContext; fullWidth?: boolean }) {
  const known = context.known.get(identity.id);
  const pending = context.pendingIds.includes(identity.id) || context.enteringId === identity.id;
  const width = fullWidth ? 'w-full' : '';
  // Pending wins over pushed/cached matches, including the route-loading gap.
  if (known && !pending) return <MatchLink match={known} scroll={false} onClick={context.prepareChat} className={`btn-secondary ${width}`}>继续聊天<span className="sr-only">，和{identity.name}</span></MatchLink>;
  return <button type="button" aria-label={`和${identity.name}打个招呼`} disabled={!context.matchesReady || pending} aria-busy={pending} onClick={() => context.meet(identity.id)} className={`btn-primary relative ${width} ${pending ? 'disabled:cursor-wait disabled:opacity-100' : ''}`}>
    <span aria-hidden={pending || undefined} className={pending ? 'invisible' : undefined}>打个招呼</span>
    {pending && <span className="pointer-events-none absolute inset-0 grid place-items-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-[18px] motion-safe:animate-spin motion-safe:[animation-duration:900ms]">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="sr-only">正在打开聊天</span>
    </span>}
  </button>;
}

export function MobileFriendCardAdapter({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  return <MobileFriendCard identity={identity} index={index} action={<FriendCardAction identity={identity} context={context} />} />;
}

export function FriendCard({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  return <div className="p-2"><article data-identity-id={identity.id} data-identity-index={index} className="person-card gap-5">
    <div className="flex w-full items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-xl font-semibold">{identity.name}</h3><p className="mt-1 text-sm text-muted">{identity.age} 岁{identity.city ? `，${identity.city}` : ''}</p></div></div>
    {identity.occupation && <p className="text-sm font-medium text-accent">{identity.occupation}</p>}
    {identity.background && <p className="text-sm leading-7 text-muted">{identity.background}</p>}
    <FriendCardAction identity={identity} context={context} fullWidth />
  </article></div>;
}

