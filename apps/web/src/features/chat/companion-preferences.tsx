"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api/client";
import type { Message } from "@/types/companion";

type Preferences = {
  userOptIn: boolean;
  allowProactiveAI: boolean;
  timezone: string;
  quietStart: number;
  quietEnd: number;
  maxBatchesPer24h: number;
  minGapMinutes: number;
  version: number;
  automationEnabled: boolean;
  memoryOptIn: boolean;
};
type Memory = {
  id: string;
  kind: string;
  content: string;
  sourceMessageId: string;
  provenance: string;
  version: number;
};
const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const minute = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
export function CompanionPreferences({
  id,
  operator,
  messages,
}: {
  id: string;
  operator: boolean;
  messages: Message[];
}) {
  const base = `/conversations/${encodeURIComponent(id)}`;
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["preferences", id],
    queryFn: () => api<Preferences>(`${base}/preferences`),
  });
  const memories = useQuery({
    queryKey: ["memories", id],
    queryFn: () =>
      api<{ items: Memory[]; proposals: Memory[] }>(`${base}/memories`),
    enabled: !operator,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function write(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`${base}${path}`, { method, body: JSON.stringify(body) });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["preferences", id] }),
        client.invalidateQueries({ queryKey: ["memories", id] }),
      ]);
      setNotice("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  const p = preferences.data;
  return (
    <details onToggle={e=>{if(e.currentTarget.open){void client.invalidateQueries({queryKey:["preferences",id]});if(!operator)void client.invalidateQueries({queryKey:["memories",id]});}}} className="mb-3 max-h-[40dvh] overflow-y-auto rounded-lg border border-line p-3 text-sm">
      <summary className="cursor-pointer text-muted">
        {operator ? "主动联系与虚拟日常" : "陪伴设置与记忆"}
      </summary>
      <p className="my-3 text-xs text-muted">
        这是虚拟陪伴身份，消息可能由 AI
        或获授权的真人参与表达。虚拟日常不代表现实活动。关闭自动互动可停止 AI
        回复和主动联系。
      </p>
      {preferences.error && <p role="alert">{preferences.error.message}</p>}
      {p && (
        <form
          key={`${p.version}:${operator}`}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void write(
              operator ? "/proactive-policy" : "/preferences",
              operator
                ? { ...p, allowProactiveAI: f.has("allow") }
                : {
                    ...p,
                    userOptIn: f.has("proactive"),
                    automationEnabled: f.has("automation"),
                    memoryOptIn: f.has("memory"),
                    timezone: String(f.get("zone")),
                    quietStart: minute(String(f.get("start"))),
                    quietEnd: minute(String(f.get("end"))),
                  },
              "PATCH",
            );
          }}
        >
          {operator ? (
            <label>
              <input
                type="checkbox"
                name="allow"
                defaultChecked={p.allowProactiveAI}
              />{" "}
              真人托管时允许 AI 主动联系（仍需用户开启）
            </label>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  name="automation"
                  defaultChecked={p.automationEnabled}
                />{" "}
                启用 AI 自动互动
              </label>
              <label>
                <input
                  type="checkbox"
                  name="memory"
                  defaultChecked={p.memoryOptIn}
                />{" "}
                允许保存我确认的长期记忆
              </label>
              <label>
                <input
                  type="checkbox"
                  name="proactive"
                  defaultChecked={p.userOptIn}
                />{" "}
                允许围绕我授权的事件主动关心
              </label>
              <label>
                时区{" "}
                <input
                  className="rounded border border-line px-2 py-1"
                  name="zone"
                  required
                  defaultValue={p.timezone}
                  placeholder="Asia/Shanghai"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <label>
                  免打扰开始{" "}
                  <input
                    type="time"
                    name="start"
                    required
                    defaultValue={clock(p.quietStart)}
                  />
                </label>
                <label>
                  结束{" "}
                  <input
                    type="time"
                    name="end"
                    required
                    defaultValue={clock(p.quietEnd)}
                  />
                </label>
              </div>
              <p className="text-xs text-muted">
                每 24 小时最多 {p.maxBatchesPer24h} 次，至少间隔{" "}
                {p.minGapMinutes / 60} 小时。主动关心不等同于定时提醒。
              </p>
            </>
          )}
          <button className="btn-secondary justify-self-start" disabled={busy}>
            保存设置
          </button>
        </form>
      )}
      {!operator && p?.memoryOptIn && (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void write("/memories", {
              sourceMessageId: f.get("source"),
              content: f.get("content"),
              kind: f.get("kind"),
            });
          }}
        >
          <label>
            记忆来源{" "}
            <select
              name="source"
              required
              className="max-w-full rounded border border-line"
            >
              {messages.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.content.slice(0, 50)}
                </option>
              ))}
            </select>
          </label>
          <label>
            记忆类型{" "}
            <select name="kind">
              <option value="FACT">事实</option>
              <option value="PREFERENCE">偏好</option>
              <option value="EXPERIENCE">经历</option>
              <option value="BOUNDARY">边界</option>
            </select>
          </label>
          <label>
            确认保存的内容{" "}
            <input
              name="content"
              required
              maxLength={300}
              className="w-full rounded border border-line p-2"
            />
          </label>
          <button
            disabled={busy || !messages.length}
            className="btn-secondary justify-self-start"
          >
            保存记忆
          </button>
        </form>
      )}
      {!operator &&
        memories.data?.proposals?.map((m) => (
          <div key={m.id} className="mt-3 rounded border border-line p-2">
            <p className="text-xs text-muted">
              待确认的记忆候选（尚未保存为长期记忆）
            </p>
            <p>{m.content}</p>
            <button
              disabled={busy}
              className="mr-3 underline"
              onClick={() =>
                void write("/memories", {
                  sourceMessageId: m.sourceMessageId,
                  kind: m.kind,
                  content: m.content,
                })
              }
            >
              确认保存
            </button>
            <button
              disabled={busy}
              className="underline"
              onClick={() =>
                void write(`/memories/${encodeURIComponent(m.id)}/delete`, {})
              }
            >
              不保存
            </button>
          </div>
        ))}
      {!operator &&
        memories.data?.items.map((m) => (
          <form
            key={`${m.id}:${m.version}`}
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void write("/memories", {
                ...m,
                content: new FormData(e.currentTarget).get("content"),
              });
            }}
          >
            <label className="grow">
              <span className="text-xs text-muted">
                {
                  (
                    {
                      USER_ASSERTED: "用户陈述",
                      HUMAN_AUTHORED: "真人撰写",
                      AI_FICTIONAL: "AI 虚构",
                      INFERRED_UNVERIFIED: "待核实推断",
                    } as Record<string, string>
                  )[m.provenance]
                }
              </span>
              <input
                aria-label="记忆内容"
                name="content"
                defaultValue={m.content}
                required
                maxLength={300}
                className="block w-full rounded border border-line p-2"
              />
            </label>
            <button disabled={busy || !p?.memoryOptIn} className="underline">
              纠正
            </button>
            <button
              type="button"
              disabled={busy}
              className="text-rose-700 underline"
              onClick={() =>
                void write(`/memories/${encodeURIComponent(m.id)}/delete`, {})
              }
            >
              删除
            </button>
          </form>
        ))}
      {!operator && p?.userOptIn && p.memoryOptIn && (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const due = new Date(String(f.get("due")));
            void write("/followups", {
              sourceMessageId: f.get("source"),
              topic: f.get("topic"),
              dueAt: due.toISOString(),
              expiresAt: new Date(due.getTime() + 86400000).toISOString(),
            });
          }}
        >
          <label>
            允许跟进的用户消息{" "}
            <select name="source" required className="max-w-full">
              {messages
                .filter((m) => m.source === "USER")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.content.slice(0, 50)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            主题{" "}
            <input
              name="topic"
              required
              maxLength={120}
              className="rounded border border-line p-1"
            />
          </label>
          <label>
            可开始关心的时间（本机时区）{" "}
            <input name="due" required type="datetime-local" />
          </label>
          <button disabled={busy} className="btn-secondary justify-self-start">
            授权一次跟进
          </button>
        </form>
      )}
      {operator && <DailyStateEditor id={id} busy={busy} write={write} />}
      {(error || memories.error) && (
        <p role="alert" className="mt-2 text-rose-700">
          {error || memories.error?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-muted">
          {notice}
        </p>
      )}
    </details>
  );
}
function DailyStateEditor({
  id,
  busy,
  write,
}: {
  id: string;
  busy: boolean;
  write: (path: string, body: unknown, method?: string) => Promise<void>;
}) {
  const state = useQuery({
    queryKey: ["daily-state", id],
    queryFn: () =>
      api<{
        version: number;
        currentActivity: string;
        mood: string;
        paused: boolean;
      }>(`/conversations/${encodeURIComponent(id)}/daily-state`),
    retry: false,
  });
  return (
    <form
      className="mt-4 grid gap-2"
      key={state.data?.version ?? 0}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await write(
          "/daily-state",
          {
            fictional: true,
            currentActivity: f.get("activity"),
            mood: f.get("mood"),
            paused: f.has("paused"),
            version: state.data?.version ?? 0,
            expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
          },
          "PATCH",
        );
        await state.refetch();
      }}
    >
      <p className="text-xs text-muted">
        此虚拟设定会影响同一身份的所有会话，24 小时后到期。
      </p>
      <label>
        虚拟活动{" "}
        <input
          name="activity"
          defaultValue={state.data?.currentActivity ?? ""}
          required
          maxLength={300}
          className="rounded border border-line p-1"
        />
      </label>
      <label>
        虚拟心情{" "}
        <input
          name="mood"
          defaultValue={state.data?.mood ?? ""}
          maxLength={80}
          className="rounded border border-line p-1"
        />
      </label>
      <label>
        <input
          name="paused"
          type="checkbox"
          defaultChecked={state.data?.paused}
        />{" "}
        暂停此虚拟设定
      </label>
      <button
        disabled={busy || state.isPending}
        className="btn-secondary justify-self-start"
      >
        保存虚拟日常
      </button>
    </form>
  );
}
