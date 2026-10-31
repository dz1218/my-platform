import type { QueryClient } from '@tanstack/query-core';
import type { CompanionMemory, MemoryCollection, MemoryKind, MemoryPreferences } from '@my-platform/shared';
import { createDomainStore } from '../create-store';

export type MemoryService = { write: (path: string, body: unknown, method?: 'POST' | 'PATCH') => Promise<unknown> };
export type MemoryDraft = { id: string; version: number; content: string; kind: MemoryKind };
export type MemoryStore = {
  busy: string | null; pendingEnabled: boolean | null; error: string; notice: string; draft: MemoryDraft | null;
  confirmation: { kind: 'delete'; id: string; version: number } | { kind: 'clear'; version: number } | null;
  activate: () => () => void;
  edit: (memory: CompanionMemory) => void; setDraft: (content: string) => void; cancel: () => void;
  setEnabled: (enabled: boolean) => Promise<void>; save: () => Promise<void>;
  resolve: (proposal: CompanionMemory, accept: boolean) => Promise<void>;
  requestDelete: (memory: CompanionMemory) => void; requestClear: () => void; confirm: () => Promise<void>;
};
export function createMemoryStore({ id, client, service }: { id: string; client: QueryClient; service: MemoryService }) {
  const preferencesKey = ['memory-preferences', id], memoriesKey = ['memories', id];
  let active = true, generation = 0;
  return createDomainStore<MemoryStore>()((set, get) => {
    const enabled = () => client.getQueryData<MemoryPreferences>(preferencesKey)?.enabled === true;
    const write = async (key: string, path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') => {
      if (!active || get().busy) return;
      const epoch = generation;
      set({ busy: key, error: '', notice: '' });
      try {
        await service.write(path, body, method);
        if (!active || epoch !== generation) return;
        await Promise.all([client.invalidateQueries({ queryKey: preferencesKey }), client.invalidateQueries({ queryKey: memoriesKey }), client.invalidateQueries({ queryKey: ['auto-reply', id] })]);
        if (active && epoch === generation) set({ draft: null, confirmation: null, notice: '已保存' });
      } catch (error) {
        if (active && epoch === generation) {
          set({ error: error instanceof Error ? error.message : '保存失败，请重试' });
          await Promise.all([client.invalidateQueries({ queryKey: preferencesKey }), client.invalidateQueries({ queryKey: memoriesKey })]);
        }
      } finally { if (active && epoch === generation) set({ busy: null, pendingEnabled: null }); }
    };
    return {
      busy: null, pendingEnabled: null, error: '', notice: '', draft: null, confirmation: null,
      activate: () => { active = true; const epoch = ++generation; return () => { if (epoch === generation) { active = false; generation++; } }; },
      edit: memory => { if (enabled() && !get().busy) set({ draft: { id: memory.id, version: memory.version, content: memory.content, kind: memory.kind }, confirmation: null, error: '', notice: '' }); },
      setDraft: content => { if (get().draft && !get().busy) set({ draft: { ...get().draft!, content } }); },
      cancel: () => { if (!get().busy) set({ draft: null, confirmation: null, error: '' }); },
      setEnabled: async value => {
        const p = client.getQueryData<MemoryPreferences>(preferencesKey);
        if (!p || !active || get().busy) return;
        set({ pendingEnabled: value });
        await write('preferences', '/memory-preferences', { enabled: value, version: p.version, consentVersion: 2 }, 'PATCH');
      },
      save: async () => {
        const draft = get().draft; if (!draft || !enabled()) return;
        if (!draft.content.trim() || [...draft.content].length > 300) { set({ error: '记忆内容需要 1–300 字' }); return; }
        await write(draft.id, '/memories', { ...draft, content: draft.content.trim() });
      },
      resolve: async (proposal, accept) => { if (accept && !enabled()) return; await write(proposal.id, `/memory-proposals/${encodeURIComponent(proposal.id)}/resolve`, { version: proposal.version, accept }); },
      requestDelete: memory => { if (!get().busy) set({ confirmation: { kind: 'delete', id: memory.id, version: memory.version }, draft: null }); },
      requestClear: () => { const p = client.getQueryData<MemoryPreferences>(preferencesKey); if (p && !get().busy) set({ confirmation: { kind: 'clear', version: p.version }, draft: null }); },
      confirm: async () => { const c = get().confirmation; if (c) await write(c.kind === 'clear' ? 'clear' : c.id, c.kind === 'clear' ? '/memories/clear' : `/memories/${encodeURIComponent(c.id)}/delete`, { version: c.version }); },
    };
  });
}
export type { CompanionMemory, MemoryCollection, MemoryPreferences };
