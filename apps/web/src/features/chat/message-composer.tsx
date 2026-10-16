"use client";
import { useRef } from "react";
import { useViewport } from '@/components/use-viewport';
import { useChatUI } from "@/stores/provider";
import { chatSelectors } from "@/stores/chat";
export function MessageComposer({
  matchId,
  name,
  sending,
  disabled,
  onSend,
  onTyping,
}: {
  matchId: string;
  name: string;
  sending: boolean;
  disabled: boolean;
  onTyping?: () => void;
  onSend: (content: string) => Promise<unknown>;
}) {
  const viewport = useViewport();
  const draft = useChatUI(chatSelectors.draft(matchId));
  const setDraft = useChatUI((state) => state.setDraft);
  const clearSentDraft = useChatUI((state) => state.clearSentDraft);
  const inFlight = useRef(false);
  async function submit() {
    if (inFlight.current || sending || disabled || !draft.trim()) return;
    inFlight.current = true;
    const original = draft;
    try {
      await onSend(original.trim());
      clearSentDraft(matchId, original);
    } catch {
      /* The conversation hook renders the error and retains the request ID. */
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="rounded-panel border border-control bg-surface-soft px-3.5 pb-2.5 pt-3 transition-colors focus-within:border-focus"
    >
      <label className="block">
        <span className="sr-only">给{name}发消息</span>
        <textarea
          name="message"
          autoComplete="off"
          rows={2}
          maxLength={2000}
          disabled={disabled}
          value={draft}
          onChange={(event) => {
            setDraft(matchId, event.target.value);
            onTyping?.();
          }}
          onKeyDown={(event) => {
            if (
              viewport === "desktop" &&
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={`和${name}说点什么…`}
          className="block max-h-[150px] min-h-10 w-full resize-none md:resize-y border-0 bg-transparent py-0.5 text-base leading-relaxed text-ink outline-none placeholder:text-muted focus-visible:outline-none"
        />
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted sm:text-xs">
          {viewport === 'desktop' ? 'Enter 发送 · Shift + Enter 换行' : '回车换行，点击发送'}
        </span>
        <button
          type="submit"
          disabled={sending || disabled || !draft.trim()}
          className="btn-primary min-w-[72px]"
        >
          {sending ? "发送中…" : "发送"}
          <span aria-hidden="true">↑</span>
        </button>
      </div>
    </form>
  );
}
