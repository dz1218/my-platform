'use client';

import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { useChatUI } from '@/stores/provider';
import type { Match } from '@/types/companion';
import { ChatEntryPreview } from './chat-entry-preview';

/** Intent prefetch only warms HTTP data; the conversation owns its socket. */
export function MatchLink({ match, children, onNavigate, onMouseEnter, onFocus, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { match: Match }) {
  const client = useQueryClient();
  const router = useRouter();
  const prepare = useChatUI(s => s.prepareMatchNavigation);
  const href = `/chat/${encodeURIComponent(match.id)}`;
  const preload = () => { prepare(client, match, true); router.prefetch(href); };
  return <Link {...props} href={href} prefetch={false}
    onNavigate={event => { prepare(client, match); onNavigate?.(event); }}
    onMouseEnter={event => { preload(); onMouseEnter?.(event); }}
    onFocus={event => { preload(); onFocus?.(event); }}>
    {children}<PendingMatch identityName={match.identity.name} />
  </Link>;
}

function PendingMatch({ identityName }: { identityName: string }) {
  const { pending } = useLinkStatus();
  const router = useRouter();
  return pending ? <ChatEntryPreview identityName={identityName}
    onBack={() => router.replace(window.location.pathname + window.location.search, { scroll: false })} /> : null;
}
