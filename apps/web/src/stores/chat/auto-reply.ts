import type { QueryClient } from '@tanstack/react-query';
import { configureAutoReply, takeover } from '@/services/chat';
import { createDomainStore } from '@/stores/create-store';
import type { AutoReply } from '@/types/companion';

type Change = Pick<AutoReply, 'mode' | 'delaySeconds'> | Pick<AutoReply, 'ownerType'>;
type AutoReplyStore = {
  busy: boolean;
  error: Error | null;
  change: (value: Change) => Promise<void>;
};

export const autoReplySelectors = {
  busy: (s: AutoReplyStore) => s.busy,
  error: (s: AutoReplyStore) => s.error,
};

export function createAutoReplyStore({ id, client }: { id: string; client: QueryClient }) {
  const queryKey = ['auto-reply', id];
  return createDomainStore<AutoReplyStore>()((set, get) => ({
    busy: false,
    error: null,
    change: async value => {
      if (get().busy || !client.getQueryData<AutoReply>(queryKey)?.canManage) return;
      set({ busy: true, error: null });
      try {
        const result = 'ownerType' in value
          ? await takeover(id, value.ownerType)
          : await configureAutoReply(id, value.mode, value.delaySeconds);
        await client.cancelQueries({ queryKey, exact: true });
        // A newer WebSocket event may have arrived before the HTTP response.
        client.setQueryData<AutoReply>(queryKey, current => current && current.version > result.version ? current : result);
      } catch (error) {
        set({ error: error instanceof Error ? error : new Error('保存失败') });
      } finally { set({ busy: false }); }
    },
  }));
}
