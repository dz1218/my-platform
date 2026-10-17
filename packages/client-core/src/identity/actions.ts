import type { QueryClient } from '@tanstack/query-core';
import type { StateCreator } from 'zustand/vanilla';
import type { IdentityService } from '../contracts';
import type { InheritanceState } from '@my-platform/shared';
import type { IdentityState } from './initial-state';
import type { IdentityStore } from './store';

export type IdentityDependencies = { client: QueryClient; service: IdentityService; accountId: string; refresh: () => void; openHome: () => void };
export type IdentityActions = {
  chooseIdentity: (identity: NonNullable<IdentityState['selectedSnapshot']>) => void;
  clearSelection: () => void;
  setFilters: (filters: IdentityState['filters']) => void;
  setGender: (gender: IdentityState['gender']) => void;
  inheritSelected: () => Promise<void>;
  skip: () => Promise<void>;
  saveGender: () => Promise<void>;
};
type Creator = StateCreator<IdentityStore, [['zustand/subscribeWithSelector', never]], [], IdentityActions>;
const asError = (error: unknown) => error instanceof Error ? error : new Error('操作失败，请重试');
export const createIdentityActions = ({ client, service, accountId, refresh, openHome }: IdentityDependencies): Creator => (set, get) => {
  const stateKey = ['identity-inheritance', accountId];
  return {
    chooseIdentity: identity => {
      if (get().pending || !identity.available) return;
      set({ selectedId: identity.id, selectedSnapshot: identity, claimError: null, skipError: null });
    },
    clearSelection: () => { if (!get().pending) set({ selectedId: null, selectedSnapshot: null }); },
    setFilters: filters => set({ filters }),
    setGender: gender => set({ gender }),
    inheritSelected: async () => {
      const id = get().selectedId;
      if (get().pending || !id || !get().selectedSnapshot?.available) return;
      set({ pending: 'inherit', claimId: id, claimError: null });
      try {
        const { identity } = await service.inheritIdentity(id);
        client.setQueryData<InheritanceState>(stateKey, previous => previous ? { ...previous, identity, onboardingCompleted: true } : previous);
        set({ selectedId: null, selectedSnapshot: null });
        await Promise.all([
          ['identity-inheritance'], ['identity-options', accountId], ['discover'], ['matches'], ['match'], ['auto-reply'], ['operator-conversations'],
        ].map(queryKey => client.invalidateQueries({ queryKey })));
        refresh();
        set({ lastInheritedId: identity.id });
      } catch (error) {
        set({ claimError: asError(error), selectedId: null, selectedSnapshot: null });
        await Promise.all([client.invalidateQueries({ queryKey: stateKey }), client.invalidateQueries({ queryKey: ['identity-options', accountId] })]);
      } finally { set({ pending: null }); }
    },
    skip: async () => {
      if (get().pending) return;
      set({ pending: 'skip', skipError: null });
      try {
        await service.skipInheritance();
        await client.invalidateQueries({ queryKey: ['identity-inheritance'] });
        openHome(); refresh();
      } catch (error) { set({ skipError: asError(error) }); }
      finally { set({ pending: null }); }
    },
    saveGender: async () => {
      const gender = get().gender;
      if (get().pending || !gender) return;
      set({ pending: 'gender', requestedGender: gender, genderError: null });
      try {
        await service.setInheritanceGender(gender);
        await client.invalidateQueries({ queryKey: stateKey });
        refresh();
      } catch (error) { set({ genderError: asError(error) }); }
      finally { set({ pending: null }); }
    },
  };
};
