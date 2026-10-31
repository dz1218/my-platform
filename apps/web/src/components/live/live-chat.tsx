"use client";
import { useEffect, useRef, type SyntheticEvent } from "react";
import type { LiveRoomMessage } from "@my-platform/shared";
import type { LiveGovernanceModel } from "./use-live-governance";
import { useViewport } from "@/components/use-viewport";
import { LiveChatLoading } from "./live-room-loading";
import { LiveIcon } from "./live-icon";

export function LiveChat({
  governance,
  connected,
  pending,
  assistantOnline,
}: {
  governance: LiveGovernanceModel;
  connected: boolean;
  pending?: boolean;
  assistantOnline?: boolean;
}) {
  const { state, data, store } = governance;
  const actions = store.getState();
  const viewport = useViewport();
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const focusDraft = useRef(false);
  useEffect(() => {
    if (!focusDraft.current) return;
    focusDraft.current = false;
    input.current?.focus();
    const end = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(end, end);
  }, [state.draft]);
  useEffect(() => {
    if (atBottom.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [data?.messages]);
  const muted = data?.self?.mute;
  const disabled = !connected || state.removed || !!muted || state.sending;
  function insertMention(event: SyntheticEvent, memberId: string) {
    if (disabled || !actions.mentionMember(memberId)) return;
    event.preventDefault();
    focusDraft.current = store.getState().draft !== state.draft;
    input.current?.focus();
    const end = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(end, end);
  }
  async function send() {
    if (disabled) return;
    if (await actions.send()) input.current?.focus();
  }
  function authorName(message: LiveRoomMessage) {
    if (message.role !== "host") return message.name;
    const member = data?.members.find((m) => m.id === message.memberId);
    const suffix = member?.code ? `·${member.code}` : "";
    return suffix && message.name.endsWith(suffix)
      ? message.name.slice(0, -suffix.length)
      : member?.name ?? message.name;
  }
  if (pending) return <LiveChatLoading />;
  return (
    <div className="live-chat">
      {data?.settings.announcement && (
        <div className="border-b border-line bg-surface-soft px-4 py-3 text-sm">
          <span className="mr-2 font-medium">置顶</span>
          <span className="whitespace-pre-wrap break-words text-muted">
            {data.settings.announcement}
          </span>
        </div>
      )}
      <div
        className="live-chat-log"
        ref={log}
        role="log"
        aria-label="直播间消息"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={() => {
          const e = log.current;
          if (e)
            atBottom.current =
              e.scrollHeight - e.scrollTop - e.clientHeight < 48;
        }}
      >
        {data?.gap && (
          <p className="px-4 py-2 text-xs text-muted">部分较早消息已过期。</p>
        )}
        {!data?.messages.length && (
          <div className="live-chat-empty">
            <p>{connected ? "暂无消息" : "连接后即可聊天"}</p>
          </div>
        )}
        {data?.messages.map((message) => {
          const member = data.members.find((m) => m.id === message.memberId);
          const canMention = !!member && (message.role === "host" || message.role === "viewer");
          const canManage =
            data.self?.role === "host" && member?.role === "viewer";
          return (
            <div
              key={message.id}
              className={`live-message ${message.memberId === data.self?.id ? "is-own" : ""}`}
            >
              {canMention ? (
                <button
                  type="button"
                  className="live-message-avatar focus-visible:outline focus-visible:outline-2"
                  aria-label={`${canManage ? "管理" : "提及"} ${message.name}（头像）`}
                  title={canManage ? "点击管理，右键 @提及" : "点击或右键 @提及"}
                  onClick={(event) => canManage ? actions.select(message.memberId) : insertMention(event, message.memberId)}
                  onContextMenu={(event) => insertMention(event, message.memberId)}
                  onKeyDown={(event) => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                      insertMention(event, message.memberId);
                  }}
                >
                  {message.name.slice(0, 1)}
                </button>
              ) : (
                <span className="live-message-avatar">{message.name.slice(0, 1)}</span>
              )}
              <div className="live-message-body">
                <div className="live-message-meta">
                  {canMention ? (
                    <button
                      type="button"
                      className="rounded-control text-left font-semibold hover:bg-surface-hover focus-visible:outline focus-visible:outline-2"
                      aria-label={`${canManage ? "管理" : "提及"} ${message.name}`}
                      title={canManage ? "点击管理，右键 @提及" : "点击或右键 @提及"}
                      onClick={(event) => canManage ? actions.select(message.memberId) : insertMention(event, message.memberId)}
                      onContextMenu={(event) => insertMention(event, message.memberId)}
                      onKeyDown={(event) => {
                        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                          insertMention(event, message.memberId);
                      }}
                    >
                      {authorName(message)}
                    </button>
                  ) : (
                    <strong>{authorName(message)}</strong>
                  )}
                  {message.role === "host" && (
                    <span className="live-message-role">主播</span>
                  )}
                  {message.role === "assistant" && (
                    <span className="live-message-role">AI 助手</span>
                  )}
                  {message.role !== "host" && message.memberId === data.self?.id && <span>我</span>}
                  <time dateTime={new Date(message.time).toISOString()}>
                    {new Date(message.time).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                {message.replyTo && (
                  <span className="mb-1 block text-xs text-muted">
                    回复{" "}
                    {(() => {
                      const source = data.messages.find((m) => m.id === message.replyTo);
                      return source ? authorName(source) : "观众提问";
                    })()}
                  </span>
                )}
                <p>{message.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form
        className="live-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {muted && (
          <p role="status" className="mb-2 text-sm text-muted">
            已禁言
            {muted.until
              ? `至 ${new Date(muted.until).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
              : "，本场直播内有效"}{" "}
            · {muted.reason}
          </p>
        )}
        {state.error && !state.panel && !state.selectedId && (
          <p role="alert" className="live-form-error">
            {state.error}
          </p>
        )}
        {!!data?.settings.slowSeconds && !muted && (
          <p className="mb-2 text-xs text-muted">
            慢速模式 · 每 {data.settings.slowSeconds} 秒可发言一次
          </p>
        )}
        <div className="live-chat-compose">
          <label className="sr-only" htmlFor="live-message">
            发送消息
          </label>
          <textarea
            id="live-message"
            ref={input}
            maxLength={500}
            rows={1}
            disabled={disabled}
            placeholder={
              muted
                ? "禁言期间可以继续观看"
                : connected
                  ? "说点什么…"
                  : "连接后即可发送消息"
            }
            value={state.draft}
            onChange={(e) => actions.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                viewport === "desktop" &&
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="live-chat-form-footer">
            {assistantOnline && (
              <button
                type="button"
                disabled={disabled}
                aria-label="向 AI 助手提问"
                className="min-h-11 min-w-11 rounded-control px-2 text-sm text-muted hover:bg-surface-hover hover:text-ink"
                onClick={() => {
                  actions.mentionAssistant();
                  input.current?.focus();
                }}
              >
                @AI
              </button>
            )}
            <span>
              {state.draft.length ? `${state.draft.length}/500` : null}
            </span>
            <button
              type="submit"
              disabled={disabled || !state.draft.trim()}
              className="live-button live-button-primary"
            >
              <LiveIcon name="send" size={17} />
              <span className="max-md:sr-only">
                {state.sending ? "发送中…" : "发送"}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
