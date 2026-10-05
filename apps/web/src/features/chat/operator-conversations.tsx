"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/services/api/client";
import type { Identity, Match } from "@/types/companion";
import { IdentityModeSwitch } from '@/features/identity/identity-mode-switch';
import { Conversation } from "./chat-room";
import "./operator-conversations.css";

type Assignment = Match & { participantName: string };

function OperatorIcon({ name, className = "" }: { name: "chat" | "refresh" | "arrow" | "shield" | "sparkles"; className?: string }) {
  const paths = {
    chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z M8 11h8 M8 15h5",
    refresh: "M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-1L20 9 M4 15l2.3 3A7 7 0 0 0 17.9 17",
    arrow: "M5 12h14 M14 7l5 5-5 5",
    shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z M8 12l3 3 5-6",
    sparkles: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z M20 2v4 M18 4h4",
  };
  return <svg className={className} aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function OperatorConversations({ identity }: { identity: Identity }) {
  const params = useSearchParams();
  const list = useQuery({
    queryKey: ["operator-conversations"],
    queryFn: () => api<{ items: Assignment[] }>("/operator/conversations"),
    refetchInterval: 30_000,
  });
  const selected = list.data?.items.find((item) => item.conversationId === params.get("id"));
  if (selected) return <Conversation key={selected.conversationId} match={selected} operator participantName={selected.participantName} />;
  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content operator-page">
      <PageHeading title="我的 AI 身份" description={`以${identity.name}的身份与其他真实用户聊天，按需要让 AI 帮你回复。`} />
      <IdentityModeSwitch identity={identity} operator />
      <section className="operator-workspace" aria-labelledby="operator-list-heading">
        <div className="operator-toolbar">
          <div className="operator-toolbar-title">
            <OperatorIcon name="chat" />
            <h2 id="operator-list-heading">和{identity.name}聊天的人</h2>
            {list.data && <span className="operator-count" aria-label={`${list.data.items.length} 个会话`}>{list.data.items.length}</span>}
          </div>
          <div className="operator-toolbar-actions">
            <span className="operator-update-note">每 30 秒自动更新</span>
            <button className="operator-refresh" disabled={list.isFetching} onClick={() => void list.refetch()}>
              <OperatorIcon name="refresh" className={list.isFetching ? "operator-spinning" : ""} />
              {list.isFetching ? "刷新中" : "刷新"}
            </button>
          </div>
        </div>
        {list.error && (
          <div role="alert" className="operator-notice">
            <div><p className="font-medium">会话列表暂时无法更新</p><p className="mt-1 text-sm">{list.error.message}</p></div>
            <button className="operator-refresh" disabled={list.isFetching} onClick={() => void list.refetch()}>重试</button>
          </div>
        )}
        {list.data && params.get("id") && !selected && <p role="alert" className="operator-notice">你当前不能以这个 AI 身份回复此会话，请选择其他会话。</p>}
        {list.isPending && !list.error && <div className="operator-loading" role="status"><OperatorIcon name="refresh" className="operator-spinning" /><p>正在加载会话…</p></div>}
        {list.data?.items.length === 0 && (
          <div className="operator-empty">
            <div className="operator-empty-art" aria-hidden="true">
              <div className="operator-message-back"><span /><span /></div>
              <div className="operator-message-front"><span /><span /><span /></div>
              <span className="operator-art-badge"><OperatorIcon name="shield" /></span>
            </div>
            <h3>等待一段对话的开始</h3>
            <p>暂时还没有其他用户和{identity.name}聊天。<br />有人开始对话后，你就可以在这里以{identity.name}的身份回复。</p>
            <span className="operator-empty-hint"><OperatorIcon name="shield" />这里使用你继承的 AI 身份</span>
          </div>
        )}
        {!!list.data?.items.length && (
          <ul className="operator-list">
            {list.data.items.map((item) => (
              <li key={item.conversationId}>
                <Link className="operator-conversation" href={`/operator?id=${encodeURIComponent(item.conversationId)}`}>
                  <span className="operator-avatar" aria-hidden="true">{item.participantName.slice(0, 1)}</span>
                  <div className="operator-conversation-copy">
                    <p className="font-medium">与{item.participantName}的对话</p>
                    <p className="mt-1.5 text-sm text-muted">以{item.identity.name}的身份参与</p>
                  </div>
                  <span className="operator-open"><span>打开会话</span><OperatorIcon name="arrow" /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="operator-guide">
          <h3>使用你的 AI 身份</h3>
          <ol>
            <li><span className="operator-step">1</span><div><h4>查看收到的对话</h4><p>其他用户与{identity.name}的对话会显示在这里。</p></div></li>
            <li><span className="operator-step">2</span><div><h4>以{identity.name}的身份回复</h4><p>打开会话，了解上下文后继续对话。</p></div></li>
            <li><span className="operator-step">3</span><div><h4>按需交给 AI</h4><p>在会话中设置 AI 托管与自动回复。</p></div></li>
          </ol>
        </div>
      </section>
      <p className="operator-footnote"><OperatorIcon name="sparkles" />你来倾听，AI 随时帮你接续对话。</p>
    </main>
  );
}
