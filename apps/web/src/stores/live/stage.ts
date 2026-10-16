import { createDomainStore } from '@/stores/create-store';

export const createLiveStageStore = () => createDomainStore<{
  focusedCall: string | null;
  setFocusedCall: (focusedCall: string | null) => void;
}>()(set => ({ focusedCall: null, setFocusedCall: focusedCall => set({ focusedCall }) }));
