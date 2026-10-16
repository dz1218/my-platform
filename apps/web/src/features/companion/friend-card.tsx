import { MatchLink } from '@/features/chat/match-link';
import { Avatar } from '@/features/identity/avatar';
import type { Identity } from '@/types/companion';
import type { CardContext } from './use-companion-home';

export function FriendCard({ data: identity, index, context }: { data: Identity; index: number; context: CardContext }) {
  const known = context.known.get(identity.id);
  return <div className="p-2"><article data-identity-id={identity.id} data-identity-index={index} className="person-card gap-5">
    <div className="flex w-full items-center gap-3"><Avatar identity={identity} large /><div className="min-w-0 flex-1"><h3 className="text-xl font-semibold">{identity.name}</h3><p className="mt-1 text-sm text-muted">{identity.age} 岁{identity.city ? `，${identity.city}` : ''}</p></div></div>
    {identity.occupation && <p className="text-sm font-medium text-accent">{identity.occupation}</p>}
    {identity.background && <p className="text-sm leading-7 text-muted">{identity.background}</p>}
    {known ? <MatchLink match={known} scroll={false} onClick={context.prepareChat} className="btn-secondary w-full">继续聊天<span className="sr-only">，和{identity.name}</span></MatchLink> : <button aria-label={`和${identity.name}打个招呼`} disabled={context.busy} onClick={() => context.meet(identity.id)} className="btn-primary w-full">{context.pendingId === identity.id ? '正在连接…' : '打个招呼'}</button>}
  </article></div>;
}

