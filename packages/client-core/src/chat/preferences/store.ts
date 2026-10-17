import type { QueryClient } from '@tanstack/query-core';
import type { PreferencesService } from '../../contracts';
import { createDomainStore } from '../../create-store';
import { initialPreferencesState, type PreferencesState, type Preferences, type DailyState } from './initial-state';

export function dailyDraftFor(draft: DailyState | null, current?: DailyState): DailyState {
  return draft && draft.version === (current?.version ?? 0) ? draft : current ?? { currentActivity: '', mood: '', paused: false, version: 0 };
}
export type PreferencesStore = PreferencesState & {
  write: (path: string, body: unknown, method?: string) => Promise<void>;
  setAllowProactiveAI: (allow: boolean) => void;
  editDailyState: (patch: Partial<Omit<DailyState, 'version'>>) => void;
  savePolicy: () => Promise<void>;
  saveDailyState: () => Promise<void>;
};
export function createPreferencesStore({ id, client, service, now = Date.now }: { id: string; client: QueryClient; service: PreferencesService; now?: () => number }) {
  return createDomainStore<PreferencesStore>()((set, get) => ({
    ...initialPreferencesState(),
    write: async (path, body, method = 'POST') => {
      if (get().busy) return;
      set({ busy: true, error: '', notice: '' });
      try {
        await service.write(id, path, body, method);
        await client.invalidateQueries({ queryKey: ['preferences', id] });
        if (path === '/daily-state') await client.invalidateQueries({ queryKey: ['daily-state', id] });
        set({ notice: '已保存' });
      } catch (error) { set({ error: error instanceof Error ? error.message : '保存失败' }); }
      finally { set({ busy: false }); }
    },
    setAllowProactiveAI: allow => {
      const current = client.getQueryData<Preferences>(['preferences', id]);
      if (current) set({ policyDraft: { version: current.version, allow } });
    },
    editDailyState: patch => set(s => ({ dailyDraft: {
      ...dailyDraftFor(s.dailyDraft, client.getQueryData<DailyState>(['daily-state', id])), ...patch,
    } })),
    savePolicy: async () => {
      const current = client.getQueryData<Preferences>(['preferences', id]);
      if (!current) return;
      const draft = get().policyDraft;
      await get().write('/proactive-policy', { ...current, allowProactiveAI: draft?.version === current.version ? draft.allow : current.allowProactiveAI }, 'PATCH');
    },
    saveDailyState: () => {
      const draft = dailyDraftFor(get().dailyDraft, client.getQueryData<DailyState>(['daily-state', id]));
      return get().write('/daily-state', {
        fictional: true, currentActivity: draft.currentActivity, mood: draft.mood,
        paused: draft.paused, version: draft.version,
        expiresAt: new Date(now() + 24 * 3600000).toISOString(),
      }, 'PATCH');
    },
  }));
}
