import { createDomainStore } from '@/stores/create-store';
export const createAuthTransitionStore = () => createDomainStore<{ closing: boolean; setClosing: (closing: boolean) => void }>()(set => ({
  closing: false,
  setClosing: closing => set({ closing }),
}));
