"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { configureAutoReply, takeover } from "@/services/chat";
import type { AutoReply } from "@/types/companion";

const modes = {
  NEVER: "关闭 AI 托管",
  TIMEOUT: "超时自动托管",
  ALWAYS: "完全交给 AI",
};

export function AutoReplyPanel({ id, settings }: { id: string; settings: AutoReply }) {
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (
      value: Pick<AutoReply, "mode" | "delaySeconds"> | Pick<AutoReply, "ownerType">,
    ) =>
      "ownerType" in value
        ? takeover(id, value.ownerType)
        : configureAutoReply(id, value.mode, value.delaySeconds),
    onSuccess: (value) => {
      void client.cancelQueries({ queryKey: ["auto-reply", id], exact: true });
      client.setQueryData<AutoReply>(["auto-reply", id], (current) =>
        current && current.version > value.version ? current : value,
      );
    },
  });
  return (
    <details className="chat-settings-section" open>
      <summary>
        <span>AI 托管</span>
        <span className="chat-settings-status" data-owner={settings.ownerType}>
          {settings.ownerType === "HUMAN" ? "真人已接管" : "AI 运营中"}
        </span>
      </summary>
      <div className="chat-settings-section-body">
        <fieldset disabled={change.isPending} className="chat-settings-fields">
          <button
            className={settings.ownerType === "AI" ? "btn-primary" : "btn-secondary"}
            type="button"
            onClick={() => change.mutate({ ownerType: settings.ownerType === "AI" ? "HUMAN" : "AI" })}
          >
            {settings.ownerType === "AI" ? "接管会话" : "结束真人接管"}
          </button>
          <label className="chat-settings-field">
            接管后的托管策略
            <select
              className="input-field min-h-10"
              value={settings.mode}
              onChange={(event) => change.mutate({ mode: event.target.value as AutoReply["mode"], delaySeconds: settings.delaySeconds })}
            >
              {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {settings.mode === "TIMEOUT" && (
            <label className="chat-settings-field">
              等待时间
              <select
                className="input-field min-h-10"
                value={settings.delaySeconds}
                onChange={(event) => change.mutate({ mode: settings.mode, delaySeconds: Number(event.target.value) })}
              >
                {[15, 30, 60, 120, 180, 300, 600].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        <p className="chat-settings-help mt-3">
          {settings.ownerType === "AI"
            ? "接管后可以用此身份回复，托管策略也会随之生效。"
            : settings.mode === "TIMEOUT"
              ? "如果我在设定时间内没有回复，AI 会自动帮我继续聊天；我主动回复后，当前 AI 自动回复会被取消。"
              : settings.mode === "NEVER"
                ? "当前由你回复，AI 不会自动发送消息。"
                : "AI 会自动回复新消息；你主动回复后，当前尚未发送的 AI 回复会被取消。"}
        </p>
        {change.isPending && <p role="status" className="mt-2 text-xs text-muted">正在保存…</p>}
        {change.error && <p role="alert" className="mt-2 text-rose-700">{change.error.message}</p>}
      </div>
    </details>
  );
}
