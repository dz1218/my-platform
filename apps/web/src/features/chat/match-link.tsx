'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { useChatUI } from '@/stores/provider';
import type { Match } from '@/types/companion';

/** Intent prefetch only warms HTTP data; the conversation owns its socket. */
export function MatchLink({ match, onNavigate, onMouseEnter, onFocus, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { match: Match }) {
  const client = useQueryClient();
  const router = useRouter();
  const prepare = useChatUI(s => s.prepareMatchNavigation);
  const href = `/chat/${encodeURIComponent(match.id)}`;
  const preload = () => { prepare(client, match, true); router.prefetch(href); };
  return <Link {...props} href={href} prefetch={false}
    onNavigate={event => { prepare(client, match); onNavigate?.(event); }}
    onMouseEnter={event => { preload(); onMouseEnter?.(event); }}
    onFocus={event => { preload(); onFocus?.(event); }} />;
}
