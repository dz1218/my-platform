"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api/client";

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

// Mounted only after the server confirms this account's identity assignment.
export function CompanionPreferences({ id }: { id: string }) {
  const base = `/conversations/${encodeURIComponent(id)}`;
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["preferences", id],
    queryFn: () => api<Preferences>(`${base}/preferences`),
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
      await client.invalidateQueries({ queryKey: ["preferences", id] });
      setNotice("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  const p = preferences.data;
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) {
          void client.invalidateQueries({ queryKey: ["preferences", id] });
        }
      }}
      className="chat-settings-section"
    >
      <summary>主动联系与虚拟日常</summary>
      <div className="chat-settings-section-body">
        <p className="chat-settings-help mb-4">
          这是虚拟陪伴身份，消息可能由 AI 或获授权的真人参与表达。虚拟日常不代表现实活动。
        </p>
        {preferences.error && <p role="alert">{preferences.error.message}</p>}
        {p && (
          <form
            key={p.version}
            className="chat-settings-fields"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void write(
                "/proactive-policy",
                { ...p, allowProactiveAI: f.has("allow") },
                "PATCH",
              );
            }}
          >
            <label className="chat-settings-checkbox">
              <input
                type="checkbox"
                name="allow"
                defaultChecked={p.allowProactiveAI}
                disabled={busy}
              />
              <span>真人托管时允许 AI 主动联系<span className="chat-settings-help block">仍需用户授权</span></span>
            </label>
            <button className="btn-secondary justify-self-start" disabled={busy}>
              保存设置
            </button>
          </form>
        )}
        <DailyStateEditor id={id} busy={busy} write={write} />
        {error && <p role="alert" className="mt-2 text-rose-700">{error}</p>}
        {notice && <p role="status" className="mt-2 text-muted">{notice}</p>}
      </div>
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
      className="chat-settings-fields chat-daily-settings"
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
      <h3 className="text-sm font-medium">虚拟日常</h3>
      <p className="chat-settings-help">
        此虚拟设定会影响同一身份的所有会话，24 小时后到期。
      </p>
      <label className="chat-settings-field">
        虚拟活动
        <input
          name="activity"
          defaultValue={state.data?.currentActivity ?? ""}
          required
          maxLength={300}
          className="input-field"
        />
      </label>
      <label className="chat-settings-field">
        虚拟心情
        <input
          name="mood"
          defaultValue={state.data?.mood ?? ""}
          maxLength={80}
          className="input-field"
        />
      </label>
      <label className="chat-settings-checkbox">
        <input
          name="paused"
          type="checkbox"
          defaultChecked={state.data?.paused}
        />
        <span>暂停此虚拟设定</span>
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
