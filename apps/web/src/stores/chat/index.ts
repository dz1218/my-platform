import { create } from 'zustand';
type ChatUI = {
  drafts: Record<string, string>; streaming: Record<string, string>;
  setDraft: (id: string, value: string) => void;
  setStream: (id: string, value: string) => void;
};
export const useChatUI = create<ChatUI>((set) => ({
  drafts: {}, streaming: {},
  setDraft: (id, value) => set(state => ({ drafts: { ...state.drafts, [id]: value } })),
  setStream: (id, value) => set(state => ({ streaming: { ...state.streaming, [id]: value } })),
}));
