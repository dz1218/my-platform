import { createDomainStore } from '../create-store';
import type { QueryClient } from '@tanstack/query-core';
import type { Match } from '@my-platform/shared';
import type { MessageHistory } from '../contracts';

export type ChatStore = {
  drafts: Record<string, string>;
  setDraft: (id: string, value: string) => void;
  clearSentDraft: (id: string, sent: string) => void;
  prepareMatchNavigation: (client: QueryClient, match: Match, preloadMessages?: boolean) => void;
};

// Created by the account provider, never a process-wide singleton.
export function createChatStore({ history }: { history: MessageHistory }) {
  return createDomainStore<ChatStore>()((set) => ({
    drafts: {},
    prepareMatchNavigation: (client, match, preloadMessages = false) => {
      // Seeding must not make an existing, possibly stale detail look fresh.
      if (!client.getQueryData<Match>(['match', match.id])) client.setQueryData(['match', match.id], match);
      if (preloadMessages && match.conversationId) void client.prefetchQuery({
        queryKey: ['messages', match.conversationId],
        queryFn: ({ signal }) => history(match.conversationId, undefined, signal),
        staleTime: 15_000,
      });
    },
    setDraft: (id, value) => set((state) => ({ drafts: { ...state.drafts, [id]: value } })),
    clearSentDraft: (id, sent) => set((state) => {
      if (state.drafts[id] !== sent) return state;
      const drafts = { ...state.drafts };
      delete drafts[id];
      return { drafts };
    }),
  }));
}
