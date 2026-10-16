"use client";
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createPreferencesStore, preferencesSelectors } from '@/stores/chat/preferences';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api/client";

import type { Preferences, DailyState } from '@/stores/chat/preferences/initial-state';
import { dailyDraftFor } from '@/stores/chat/preferences/store';

// Mounted only after the server confirms this account's identity assignment.
export function CompanionPreferences({ id }: { id: string }) {
  const base = `/conversations/${encodeURIComponent(id)}`;
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["preferences", id],
    queryFn: () => api<Preferences>(`${base}/preferences`),
  });
  const ui = useStoreInstance(() => createPreferencesStore({ id, client }));
  const { error, notice, busy } = useStore(ui, useShallow(preferencesSelectors.view));
  const { savePolicy, setAllowProactiveAI } = ui.getState();
  const policyDraft = useStore(ui, s => s.policyDraft);
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
              void savePolicy();
            }}
          >
            <label className="chat-settings-checkbox">
              <input
                type="checkbox"
                name="allow"
                checked={policyDraft?.version === p.version ? policyDraft.allow : p.allowProactiveAI}
                onChange={e => setAllowProactiveAI(e.target.checked)}
                disabled={busy}
              />
              <span>真人托管时允许 AI 主动联系<span className="chat-settings-help block">仍需用户授权</span></span>
            </label>
            <button className="btn-secondary justify-self-start" disabled={busy}>
              保存设置
            </button>
          </form>
        )}
        <DailyStateEditor id={id} busy={busy} ui={ui} />
        {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
        {notice && <p role="status" className="mt-2 text-muted">{notice}</p>}
      </div>
    </details>
  );
}
function DailyStateEditor({ id, busy, ui }: { id: string; busy: boolean; ui: ReturnType<typeof createPreferencesStore> }) {
  const storedDraft = useStore(ui, s => s.dailyDraft);
  const { editDailyState, saveDailyState } = ui.getState();
  const state = useQuery({
    queryKey: ["daily-state", id],
    queryFn: () =>
      api<DailyState>(`/conversations/${encodeURIComponent(id)}/daily-state`),
    retry: false,
  });
  const draft = dailyDraftFor(storedDraft, state.data);
  return (
    <form
      className="chat-settings-fields chat-daily-settings"
      key={state.data?.version ?? 0}
      onSubmit={async (e) => {
        e.preventDefault();
        await saveDailyState();
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
          value={draft.currentActivity}
          onChange={e => editDailyState({ currentActivity: e.target.value })}
          required
          maxLength={300}
          className="input-field"
        />
      </label>
      <label className="chat-settings-field">
        虚拟心情
        <input
          name="mood"
          value={draft.mood}
          onChange={e => editDailyState({ mood: e.target.value })}
          maxLength={80}
          className="input-field"
        />
      </label>
      <label className="chat-settings-checkbox">
        <input
          name="paused"
          type="checkbox"
          checked={draft.paused}
          onChange={e => editDailyState({ paused: e.target.checked })}
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
