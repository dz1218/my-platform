"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMatch } from "@/services/companion";
import { useConversation } from "./hooks/use-conversation";
import { AutoReplyPanel } from "./auto-reply-panel";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import type { Match } from "@/types/companion";

export function ChatRoom({ matchId }: { matchId: string }) {
  const match = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => getMatch(matchId),
  });
  if (match.isPending)
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="p-12 text-center text-slate-600"
      >
        正在打开聊天…
      </main>
    );
  if (!match.data)
    return (
      <main id="main-content" tabIndex={-1} className="p-12 text-center">
        <p role="alert">{match.error?.message ?? "暂时无法打开聊天"}</p>
        <Link href="/companion" className="btn-secondary mt-6">
          返回陪伴
        </Link>
      </main>
    );
  return <Conversation key={match.data.conversationId} match={match.data} />;
}
export function Conversation({ match, operator = false, participantName }: { match: Match; operator?: boolean; participantName?: string }) {
  const chat = useConversation(match.conversationId);
  const bottom = useRef<HTMLDivElement | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const oldestLoading = useRef(false);
  const newestID = chat.messages.at(-1)?.id;
  useEffect(() => {
    if (nearBottom.current && !oldestLoading.current) {
      const el = scroll.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    }
  }, [newestID, chat.outgoing]);
  async function loadOlder() {
    const el = scroll.current;
    const height = el?.scrollHeight ?? 0;
    oldestLoading.current = true;
    nearBottom.current = false;
    await chat.loadOlder();
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - height;
      oldestLoading.current = false;
    });
  }
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="chat-layout"
      aria-label={operator ? `与${participantName ?? "用户"}的对话` : `和${match.identity.name}的聊天`}
    >
      <header className="flex items-center gap-2.5 border-b border-line bg-panel px-3.5 py-3 sm:py-2.5">
        <Link
          href={operator ? "/operator" : "/companion"}
          aria-label={operator ? "返回接管列表" : "返回陪伴"}
          className="grid h-10 w-9 place-items-center rounded-lg text-2xl text-muted hover:bg-brand-50 hover:text-ink"
        >
          ←
        </Link>
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-brand-50 text-xl text-brand-600"
          aria-hidden="true"
        >
          {match.identity.name.slice(-1)}
        </div>
        <div>
          <h1 className="text-base font-semibold">{operator ? `与${participantName ?? "用户"}的对话` : match.identity.name}</h1>
          <p className="mt-1 text-xs text-muted">{operator ? `以${match.identity.name}的身份回复` : "对话可能由 AI 与真人共同参与"}</p>
        </div>
        <span className="ml-auto hidden text-xs text-muted sm:block">今晚</span>
      </header>
      <div
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el)
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="chat-history min-h-0 overflow-y-auto overscroll-contain px-3.5 py-4"
      >
        <p className="mb-5 flex items-center justify-center gap-3.5 text-xs text-muted before:h-px before:w-10 before:bg-line before:content-[''] after:h-px after:w-10 after:bg-line after:content-['']">
          聊天记录
        </p>
        {chat.hasOlder && (
          <button
            disabled={chat.loadingOlder}
            onClick={() => void loadOlder()}
            className="mx-auto mb-6 block text-xs text-slate-600"
          >
            {chat.loadingOlder ? "正在加载…" : "查看更早的消息"}
          </button>
        )}
        {chat.olderError && (
          <p role="alert" className="mb-4 text-center text-sm text-rose-700">
            {chat.olderError.message}
          </p>
        )}
        {chat.latest.isPending ? (
          <p className="text-center text-sm text-slate-500">
            正在打开你们的对话…
          </p>
        ) : (
          !chat.messages.length && (
            <p className="my-12 text-center text-sm text-slate-500">
              还没有消息，和{match.identity.name}打个招呼吧。
            </p>
          )
        )}
        {chat.latest.error && (
          <div role="alert" className="mb-5 text-center text-sm text-rose-700">
            暂时连接不上，正在尝试恢复。
            <button
              onClick={() => void chat.latest.refetch()}
              className="ml-3 underline"
            >
              重试
            </button>
          </div>
        )}
        <div role="log" aria-label="聊天记录" className="flex flex-col gap-3.5">
          {chat.messages.map((message) => (
            <MessageBubble key={message.id} message={message} operator={operator} />
          ))}
          {chat.outgoing && (
            <MessageBubble
              sending
              operator={operator}
              message={{
                id: chat.outgoing.requestId,
                content: chat.outgoing.content,
                senderType: operator ? "identity" : "user",
                source: operator ? "HUMAN" : "USER",
                sender: { id: "self", name: operator ? match.identity.name : "我" },
                status: "pending",
                createdAt: "",
              }}
            />
          )}
        </div>
        <div ref={bottom} />
      </div>
      <footer className="border-t border-line bg-panel px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-4">
        {chat.error && (
          <p role="alert" className="mb-3 text-sm text-rose-700">
            {chat.error.message}
          </p>
        )}
        {chat.settings.data?.canManage && <AutoReplyPanel id={match.conversationId} settings={chat.settings.data} />}
        {chat.settings.error && <p role="alert">{chat.settings.error.message}</p>}
        <MessageComposer
          matchId={operator ? `operator:${match.conversationId}` : match.id}
          name={operator ? (participantName ?? "用户") : match.identity.name}
          sending={chat.sending}
          disabled={chat.latest.isPending || (operator && (chat.settings.isError || !chat.settings.data?.canManage || chat.settings.data.ownerType !== "HUMAN"))}
          onSend={(content) => {
            nearBottom.current = true;
            return chat.send(content);
          }}
        />
      </footer>
    </main>
  );
}
