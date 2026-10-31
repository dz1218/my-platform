"use client";
import { useId, type ReactNode } from "react";
import {
  liveMemberLabel,
  type LiveModerationAction,
  type LiveSettings,
} from "@my-platform/shared";
import { MobileLiveManagementSheet } from "@my-platform/mobile-web/live-room";
import { Select } from "@/components/select";
import { Sheet } from "@/components/sheet";
import { useViewport } from "@/components/use-viewport";
import type { LiveGovernanceModel } from "./use-live-governance";

const control = "btn-secondary min-h-11";
const field = "input-field";
const toolbarControl = "flex min-h-11 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-control px-2 text-xs text-muted hover:bg-surface-hover hover:text-ink";
const statusLabels: Record<LiveModerationAction["status"], string> = {
  proposed: "等待主播确认",
  pending: "处理中",
  applied: "已执行",
  failed: "执行失败",
  revoked: "已解除",
  dismissed: "已忽略",
};
export function LiveManagementToolbar({
  model,
}: {
  model: LiveGovernanceModel;
}) {
  if (!model.state.token || model.state.removed) return null;
  const a = model.store.getState();
  const host = model.data?.self?.role === "host";
  const pending =
    model.data?.actions?.filter((a) => a.status === "proposed").length ?? 0;
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-1">
      <button
        type="button"
        className={toolbarControl}
        onClick={() => a.openPanel("nickname")}
      >
        我的昵称
      </button>
      {host && (
        <>
          <button
            type="button"
            className={toolbarControl}
            onClick={() => a.openPanel("settings")}
          >
            房间设置
          </button>
          <button
            type="button"
            className={toolbarControl}
            onClick={() => a.openPanel("records")}
          >
            管理记录
            {pending > 0 && <span aria-label={`${pending} 待确认`} className="rounded-full bg-surface-selected px-1.5 py-0.5 text-xs tabular-nums text-ink">{pending}</span>}
          </button>
        </>
      )}
    </div>
  );
}
export function LiveGovernedMembers({
  model,
  onSelect,
}: {
  model: LiveGovernanceModel;
  onSelect?: () => void;
}) {
  const host = model.data?.self?.role === "host";
  return (
    <div className="divide-y divide-line">
      {model.data?.members
        .filter((m) => m.online || m.mute || m.ban)
        .map((m) => (
          <div key={m.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-soft text-sm">
              {m.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {liveMemberLabel(m)}
                {m.id === model.data?.self?.id ? "（我）" : ""}
              </p>
              <p className="text-xs text-muted">
                {m.role === "host"
                  ? "主播"
                  : m.ban
                    ? "本场已移出"
                    : m.mute
                      ? "禁言中"
                      : m.online
                        ? "观众"
                        : "已离开"}
              </p>
            </div>
            {host && m.role === "viewer" && (
              <button
                type="button"
                className={control}
                aria-label={`管理 ${liveMemberLabel(m)}`}
                onClick={() => {
                  onSelect?.();
                  model.store.getState().select(m.id);
                }}
              >
                管理
              </button>
            )}
          </div>
        ))}
      {!model.data?.members.length && (
        <p className="py-4 text-sm text-muted">连接后显示房间成员</p>
      )}
    </div>
  );
}
export function LiveManagementPanels({
  model,
}: {
  model: LiveGovernanceModel;
}) {
  const viewport = useViewport();
  const formId = useId();
  const { state, data, store } = model;
  const a = store.getState();
  const selected = data?.members.find((m) => m.id === state.selectedId);
  const close = () => {
    if (!state.busy) {
      a.select(null);
      a.openPanel(null);
    }
  };
  let title = "成员管理";
  let content: ReactNode = null;
  if (state.selectedId) {
    title = selected ? liveMemberLabel(selected) : "成员管理";
    content = selected ? (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {selected.ban
            ? "本场已移出"
            : selected.mute
              ? `已禁言 · ${selected.mute.reason}`
              : selected.online
                ? "正在观看"
                : "已离开直播间"}
        </p>
        <label className="block text-sm">
          处理原因
          <input
            className={`${field} mt-2`}
            maxLength={200}
            value={state.reason}
            onChange={(e) => a.setReason(e.target.value)}
            placeholder="选填，例如：持续刷屏"
          />
        </label>
        {state.kickConfirm ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-6">
              移出后，该观众本场直播内不可重新进入。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={control}
                disabled={state.busy}
                onClick={() => a.confirmKick(false)}
              >
                取消
              </button>
              <button
                type="button"
                className={`${control} text-danger`}
                disabled={state.busy}
                onClick={() =>
                  void a.moderate({
                    kind: "kick",
                    memberId: selected.id,
                    reason: state.reason,
                  })
                }
              >
                {state.busy ? "处理中…" : "确认踢出"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {([300, 1800, 0] as const).map((duration) => (
              <button
                type="button"
                key={duration}
                className={control}
                disabled={state.busy || !!selected.ban}
                onClick={() =>
                  void a.moderate({
                    kind: "mute",
                    duration,
                    memberId: selected.id,
                    reason: state.reason,
                  })
                }
              >
                禁言
                {duration === 0
                  ? "本场"
                  : duration === 300
                    ? "5分钟"
                    : "30分钟"}
              </button>
            ))}
            <button
              type="button"
              className={`${control} text-danger`}
              disabled={state.busy || !!selected.ban}
              onClick={() => a.confirmKick(true)}
            >
              踢出直播间
            </button>
            {selected.mute && (
              <button
                type="button"
                className={control}
                disabled={state.busy}
                onClick={() =>
                  void a.moderate({
                    kind: "revoke",
                    actionId: selected.mute!.actionId,
                  })
                }
              >
                解除禁言
              </button>
            )}
            {selected.ban && (
              <button
                type="button"
                className={control}
                disabled={state.busy}
                onClick={() =>
                  void a.moderate({
                    kind: "revoke",
                    actionId: selected.ban!.actionId,
                  })
                }
              >
                允许重新进入
              </button>
            )}
          </div>
        )}
      </div>
    ) : (
      <p className="text-sm text-muted">
        该成员已离开，可以在管理记录中查看此前操作。
      </p>
    );
  } else if (state.panel === "nickname") {
    title = "我的昵称";
    content = (
      <form
        id={formId}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void a.saveName();
        }}
      >
        <label className="block text-sm">
          房间昵称
          <input
            className={`${field} mt-2`}
            value={state.nameDraft}
            maxLength={40}
            onChange={(e) => a.setName(e.target.value)}
          />
        </label>
        <p className="text-xs leading-5 text-muted">
          房间内所有人都会看到新昵称。
        </p>
      </form>
    );
  } else if (state.panel === "settings" && state.settingsDraft) {
    title = "房间与助手设置";
    content = (
      <LiveSettingsForm
        id={formId}
        settings={state.settingsDraft}
        set={a.setSettings}
        save={() => void a.saveSettings()}
        busy={state.busy}
      />
    );
  } else if (state.panel === "records") {
    title = "管理记录";
    content = (
      <div className="divide-y divide-line">
        {[...(data?.actions ?? [])].reverse().map((action) => {
          const member = data?.members.find((m) => m.id === action.memberId);
          const active =
            member?.mute?.actionId === action.id ||
            member?.ban?.actionId === action.id;
          return (
            <article key={action.id} className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <strong className="min-w-0 break-words">
                  {action.name} · {action.kind === "kick" ? "踢出" : "禁言"}
                </strong>
                <span className="shrink-0 text-muted">
                  {statusLabels[action.status]}
                </span>
              </div>
              <p className="text-sm text-muted">{action.reason}</p>
              {action.evidence.map((text, i) => (
                <blockquote
                  key={i}
                  className="border-l-2 border-line pl-3 text-sm text-muted"
                >
                  {text}
                </blockquote>
              ))}
              <p className="text-xs text-muted">
                {action.actor === "assistant" ? "AI 助手" : "主播"} ·{" "}
                {new Date(action.createdAt).toLocaleString("zh-CN")}
                {action.kind === "mute" && action.status !== "dismissed"
                  ? action.status === "proposed"
                    ? " · 确认后禁言 5 分钟"
                    : action.until
                      ? ` · 至 ${new Date(action.until).toLocaleTimeString("zh-CN")}`
                      : " · 本场直播"
                  : ""}
              </p>
              {action.error && (
                <p role="status" className="text-xs text-danger">
                  {action.error}
                </p>
              )}
              {action.status === "proposed" && !action.memberId && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${formId}-${action.id}-target`} className="block text-sm">选择观众</label>
                <Select
                  id={`${formId}-${action.id}-target`}
                  label="选择观众"
                  placeholder="请选择具体观众"
                  value={state.proposalTargets[action.id] ?? ""}
                  disabled={state.busy}
                  onChange={(value) => a.setProposalTarget(action.id, value)}
                  options={(data?.members ?? [])
                    .filter((m) => m.role === "viewer")
                    .map((m) => ({ value: m.id, label: liveMemberLabel(m) }))}
                />
                </div>
              )}
              {action.status === "proposed" && action.kind === "kick" && (
                <p className="text-xs text-muted">
                  确认后立即移出，本场直播内不可重新进入。
                </p>
              )}
              <div className="flex gap-2">
                {action.status === "proposed" && (
                  <>
                    <button
                      className="btn-primary min-h-11"
                      disabled={
                        state.busy ||
                        (!action.memberId && !state.proposalTargets[action.id])
                      }
                      onClick={() =>
                        void a.moderate({
                          kind: "approve",
                          actionId: action.id,
                          memberId: state.proposalTargets[action.id],
                        })
                      }
                    >
                      确认{action.kind === "kick" ? "踢出" : "禁言"}
                    </button>
                    <button
                      className={control}
                      disabled={state.busy}
                      onClick={() =>
                        void a.moderate({
                          kind: "dismiss",
                          actionId: action.id,
                        })
                      }
                    >
                      忽略
                    </button>
                  </>
                )}
                {action.status === "failed" && (
                  <button
                    className={control}
                    disabled={state.busy}
                    onClick={() =>
                      void a.moderate({ kind: "retry", actionId: action.id })
                    }
                  >
                    重试
                  </button>
                )}
                {active && (
                  <button
                    className={control}
                    disabled={state.busy}
                    onClick={() =>
                      void a.moderate({ kind: "revoke", actionId: action.id })
                    }
                  >
                    解除限制
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!data?.actions?.length && (
          <p className="py-4 text-sm text-muted">暂无管理记录。</p>
        )}
      </div>
    );
  }
  const open = !!(state.selectedId || state.panel);
  const body = (
    <>
      {content}
      {state.error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {state.error}
        </p>
      )}
    </>
  );
  const footer = (state.panel === "settings" || state.panel === "nickname") && !state.selectedId ? (
    <div className="flex items-center justify-end gap-3">
      <button type="button" className={control} disabled={state.busy} onClick={close}>取消</button>
      <button type="submit" form={formId} className="btn-primary min-h-11" disabled={state.busy}>
        {state.busy ? "保存中…" : state.panel === "nickname" ? "保存昵称" : "保存设置"}
      </button>
    </div>
  ) : undefined;
  return viewport === "mobile" ? (
    <MobileLiveManagementSheet open={open} onClose={close} title={title} footer={footer}>
      {body}
    </MobileLiveManagementSheet>
  ) : (
    <Sheet open={open} onClose={close} title={title} desktopCentered footer={footer} className={state.panel === "settings" || state.panel === "records" ? "md:w-[560px]!" : "md:w-[420px]!"}>
      {body}
    </Sheet>
  );
}
function LiveSettingsForm({
  id,
  settings: s,
  set,
  save,
  busy,
}: {
  id: string;
  settings: LiveSettings;
  set: (patch: Partial<LiveSettings>) => void;
  save: () => void;
  busy: boolean;
}) {
  return (
    <form
      id={id}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-5">
        <legend className="mb-3 text-sm font-semibold">房间规则</legend>
        <label className="block text-sm font-medium">
          置顶公告
          <textarea
            className={`${field} mt-2 resize-y`}
            rows={2}
            maxLength={500}
            value={s.announcement}
            onChange={(e) => set({ announcement: e.target.value })}
          />
        </label>
        <label className="block text-sm font-medium">
          房规
          <textarea
            className={`${field} mt-2 resize-y`}
            rows={3}
            maxLength={2000}
            value={s.rules}
            onChange={(e) => set({ rules: e.target.value })}
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">慢速发言</legend>
          <div className="grid grid-cols-4 gap-1 rounded-control bg-surface-soft p-1">
            {([0, 5, 10, 30] as const).map((n) => (
              <button
                type="button"
                key={n}
                aria-pressed={s.slowSeconds === n}
                className={`min-h-11 rounded-control px-1 text-sm transition-colors disabled:opacity-40 ${s.slowSeconds === n ? "bg-panel font-medium text-ink" : "text-muted hover:bg-surface-hover hover:text-ink"}`}
                onClick={() => set({ slowSeconds: n })}
              >
                {n ? `${n}秒/条` : "关闭"}
              </button>
            ))}
          </div>
        </fieldset>
        <section className="flex flex-col gap-2 border-t border-line pt-5">
          <h3 className="text-sm font-semibold">AI 助手</h3>
          {(
            [
              { key: "autoReply", label: "选择性自动回复" },
              { key: "autoModeration", label: "规则提醒与短时禁言" },
              { key: "welcome", label: "合并欢迎新观众" },
            ] as const
          ).map((item) => (
            <button
              type="button"
              role="switch"
              aria-checked={s[item.key]}
              key={item.key}
              onClick={() => set({ [item.key]: !s[item.key] })}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control text-left text-sm disabled:opacity-40"
            >
              <span>{item.label}</span>
              <span aria-hidden="true" className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ${s[item.key] ? "bg-action" : "bg-surface-selected"}`}>
                <span className={`size-5 rounded-full transition-transform motion-reduce:transition-none ${s[item.key] ? "translate-x-4 bg-on-action" : "bg-muted"}`} />
              </span>
            </button>
          ))}
          <p className="text-xs leading-6 text-muted">
            助手入场后生效。自动管理先提醒，再禁言 5 分钟；主播通过 @AI 发出的明确管理指令直接执行。
          </p>
        </section>
        <label className="block text-sm font-medium">
          拦截词<span className="ml-2 font-normal text-muted">每行一个</span>
          <textarea
            className={`${field} mt-2 resize-y`}
            rows={3}
            value={(s.blockedPhrases ?? []).join("\n")}
            onChange={(e) =>
              set({ blockedPhrases: e.target.value.split("\n") })
            }
          />
        </label>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">
            常见问题 · {s.faq?.length ?? 0}/20
          </legend>
          {(s.faq ?? []).map((faq, i) => (
            <div className="flex flex-col gap-2 border-b border-line pb-3" key={i}>
              <label className="block text-sm">
                问题 {i + 1}
                <input
                  className={`${field} mt-1`}
                  maxLength={200}
                  value={faq.question}
                  onChange={(e) =>
                    set({
                      faq: s.faq.map((q, index) =>
                        index === i ? { ...q, question: e.target.value } : q,
                      ),
                    })
                  }
                />
              </label>
              <label className="block text-sm">
                回答
                <textarea
                  className={`${field} mt-1`}
                  maxLength={500}
                  rows={2}
                  value={faq.answer}
                  onChange={(e) =>
                    set({
                      faq: s.faq.map((q, index) =>
                        index === i ? { ...q, answer: e.target.value } : q,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className={control}
                onClick={() =>
                  set({ faq: s.faq.filter((_, index) => index !== i) })
                }
              >
                移除问答
              </button>
            </div>
          ))}
          <button
            type="button"
            className={control}
            disabled={(s.faq?.length ?? 0) >= 20}
            onClick={() =>
              set({ faq: [...(s.faq ?? []), { question: "", answer: "" }] })
            }
          >
            添加问答
          </button>
        </fieldset>
      </fieldset>
      <p className="text-xs text-muted">
        设置会保存，后续开播继续沿用。处罚仅对本场直播生效。
      </p>
    </form>
  );
}
