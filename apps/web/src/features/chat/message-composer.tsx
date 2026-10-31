"use client";
import { MobileMessageComposer } from "@my-platform/mobile-web/chat";
import { useViewport } from '@/components/use-viewport';
import { useChatUI } from "@/stores/provider";
import { chatSelectors } from "@/stores/chat";
export function MessageComposer({
  matchId,
  name,
  disabled,
  onSend,
  onTyping,
}: {
  matchId: string;
  name: string;
  disabled: boolean;
  onTyping?: () => void;
  onSend: (content: string) => Promise<unknown>;
}) {
  const draft = useChatUI(chatSelectors.draft(matchId));
  const setDraft = useChatUI((state) => state.setDraft);
  const clearSentDraft = useChatUI((state) => state.clearSentDraft);
  async function submit() {
    if (disabled || !draft.trim()) return;
    const original = draft;
    clearSentDraft(matchId, original);
    try {
      await onSend(original.trim());
    } catch {
      /* The conversation hook renders the error and retains the request ID. */
    }
  }
  return <MessageComposerView name={name} draft={draft} disabled={disabled}
    onChange={value => { setDraft(matchId, value); onTyping?.(); }} onSubmit={() => void submit()} />;
}

/** Shared presentation also renders before an account/store is available. */
export function MessageComposerView({ name, draft, disabled, onChange, onSubmit }: {
  name: string; draft: string; disabled: boolean;
  onChange: (value: string) => void; onSubmit: () => void;
}) {
  const viewport = useViewport();
  if (viewport === 'mobile') return <MobileMessageComposer name={name} draft={draft} sending={false} disabled={disabled}
    onChange={onChange} onSend={onSubmit} />;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="input-group px-3.5 pb-2.5 pt-3"
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
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (
              viewport === "desktop" &&
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onSubmit();
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
          disabled={disabled || !draft.trim()}
          className="btn-primary min-w-[72px]"
        >
          发送
          <span aria-hidden="true">↑</span>
        </button>
      </div>
    </form>
  );
}
