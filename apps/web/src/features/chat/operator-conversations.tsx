"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/services/api/client";
import type { Match } from "@/types/companion";
import { Conversation } from "./chat-room";

type Assignment = Match & { participantName: string };

export function OperatorConversations() {
  const params = useSearchParams();
  const list = useQuery({
    queryKey: ["operator-conversations"],
    queryFn: () => api<{ items: Assignment[] }>("/operator/conversations"),
    refetchInterval: 30_000,
  });
  const selected = list.data?.items.find((item) => item.conversationId === params.get("id"));
  if (selected) return <Conversation key={selected.conversationId} match={selected} operator participantName={selected.participantName} />;
  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <PageHeading title="真人接管" description="以陪伴身份继续对话，按需要让 AI 帮你回复。" />
      {list.isPending && <p role="status">正在加载会话…</p>}
      {list.error && (
        <p role="alert">
          {list.error.message}
          <button className="ml-3 underline" onClick={() => void list.refetch()}>重试</button>
        </p>
      )}
      {list.data?.items.length === 0 && (
        <p className="empty-state">暂无分配给你的会话。获得会话授权后，可以在这里接管并回复。</p>
      )}
      {list.data && params.get("id") && !selected && <p role="alert" className="mb-4 text-sm text-muted">此会话已不在你的接管列表中。</p>}
      <ul className="content-panel divide-y divide-line">
        {list.data?.items.map((item) => (
          <li key={item.conversationId}>
            <Link className="flex min-h-20 items-center justify-between gap-4 px-5 py-4 hover:bg-brand-50" href={`/operator?id=${encodeURIComponent(item.conversationId)}`}>
              <div>
                <p className="font-medium">与{item.participantName}的对话</p>
                <p className="mt-1 text-xs text-muted">以{item.identity.name}的身份参与</p>
              </div>
              <span className="text-sm text-brand-600">打开会话</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
