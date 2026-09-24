import { create } from 'zustand';
type ChatUI = { drafts: Record<string, string>; setDraft: (id: string, value: string) => void };
export const useChatUI = create<ChatUI>(set => ({
  drafts: {}, setDraft: (id, value) => set(state => ({ drafts: { ...state.drafts, [id]: value } })),
}));
