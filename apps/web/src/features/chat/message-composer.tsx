'use client';
import { useRef } from 'react';
import { useChatUI } from '@/stores/chat';
export function MessageComposer({ matchId, name, sending, disabled, onSend }: {
  matchId: string; name: string; sending: boolean; disabled: boolean; onSend: (content: string) => Promise<unknown>;
}) {
  const draft = useChatUI(state => state.drafts[matchId] ?? '');
  const setDraft = useChatUI(state => state.setDraft);
  const inFlight = useRef(false);
  async function submit() {
    if (inFlight.current || sending || disabled || !draft.trim()) return;
    inFlight.current = true;
    const original = draft;
    try {
      await onSend(original.trim());
      if (useChatUI.getState().drafts[matchId] === original) setDraft(matchId, '');
    } catch { /* The conversation hook renders the error and retains the request ID. */ }
    finally { inFlight.current = false; }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex items-end gap-3">
    <label className="min-w-0 flex-1"><span className="sr-only">给{name}发消息</span><textarea rows={2} maxLength={2000} value={draft} onChange={event => setDraft(matchId, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder="想说些什么…" className="input-glass resize-none" /></label>
    <button type="submit" disabled={sending || disabled || !draft.trim()} className="btn-indigo mb-0.5">{sending ? '发送中…' : '发送'}</button>
  </form>;
}
