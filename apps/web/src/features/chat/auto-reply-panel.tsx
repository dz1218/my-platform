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
    <details className="mb-3 max-h-[40dvh] overflow-y-auto rounded-lg border border-line p-3 text-sm" open>
      <summary className="cursor-pointer font-medium">
        {settings.ownerType === "HUMAN" ? "真人已接管" : "AI 运营中"}
        <span className="ml-2 font-normal text-muted">
          {settings.ownerType === "HUMAN" ? modes[settings.mode] : "可接管此会话"}
        </span>
      </summary>
      <fieldset disabled={change.isPending} className="mt-3 flex flex-wrap items-end gap-3">
        <button
          className="btn-secondary"
          type="button"
          onClick={() => change.mutate({ ownerType: settings.ownerType === "AI" ? "HUMAN" : "AI" })}
        >
          {settings.ownerType === "AI" ? "接管会话" : "结束真人接管"}
        </button>
        <label className="grid gap-1 text-xs text-muted">
          接管后的托管策略
          <select
            className="min-h-10 rounded border border-line bg-panel p-2 text-sm text-ink"
            value={settings.mode}
            onChange={(event) => change.mutate({ mode: event.target.value as AutoReply["mode"], delaySeconds: settings.delaySeconds })}
          >
            {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {settings.mode === "TIMEOUT" && (
          <label className="grid gap-1 text-xs text-muted">
            等待时间
            <select
              className="min-h-10 rounded border border-line bg-panel p-2 text-sm text-ink"
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
      <p className="mt-2 max-w-prose text-xs leading-5 text-muted">
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
    </details>
  );
}
