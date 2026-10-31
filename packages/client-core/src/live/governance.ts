import type { QueryClient } from "@tanstack/query-core";
import { liveMemberLabel } from "@my-platform/shared";
import type {
  LiveActivity,
  LiveModerationInput,
  LiveRoomJoin,
  LiveRoomMessage,
  LiveSettings,
} from "@my-platform/shared";
import { createDomainStore } from "../create-store";

export type LiveGovernanceServices = {
  client: QueryClient;
  queryKey: readonly string[];
  createRequestId: () => string;
  activity: (token: string) => Promise<LiveActivity>;
  send: (
    token: string,
    requestId: string,
    text: string,
  ) => Promise<{ message: LiveRoomMessage }>;
  moderate: (token: string, input: LiveModerationInput) => Promise<unknown>;
  rename: (token: string, requestId: string, name: string) => Promise<unknown>;
  settings: (
    token: string,
    requestId: string,
    settings: LiveSettings,
  ) => Promise<unknown>;
};
export type LiveGovernanceState = {
  token: string;
  generation: number;
  removed: boolean;
  draft: string;
  sending: boolean;
  busy: boolean;
  error: string;
  selectedId: string | null;
  panel: "settings" | "records" | "nickname" | null;
  kickConfirm: boolean;
  reason: string;
  nameDraft: string;
  settingsDraft: LiveSettings | null;
  proposalTargets: Record<string, string>;
  setProposalTarget: (actionId: string, memberId: string) => void;
  bind: (joined: LiveRoomJoin) => void;
  receive: (event: LiveActivity) => void;
  refresh: () => Promise<void>;
  setDraft: (value: string) => void;
  mentionAssistant: () => void;
  select: (id: string | null) => void;
  openPanel: (panel: LiveGovernanceState["panel"]) => void;
  setReason: (value: string) => void;
  setName: (value: string) => void;
  setSettings: (patch: Partial<LiveSettings>) => void;
  confirmKick: (value: boolean) => void;
  markRemoved: () => void;
  send: () => Promise<boolean>;
  moderate: (input: Omit<LiveModerationInput, "requestId">) => Promise<void>;
  mentionMember: (memberId: string) => boolean;
  saveName: () => Promise<void>;
  saveSettings: () => Promise<void>;
  clear: () => void;
};
export function createLiveGovernanceStore(services: LiveGovernanceServices) {
  const initial = {
    token: "",
    generation: 0,
    removed: false,
    draft: "",
    sending: false,
    busy: false,
    error: "",
    selectedId: null,
    panel: null,
    kickConfirm: false,
    reason: "",
    nameDraft: "",
    settingsDraft: null,
    proposalTargets: {},
  };
  const attempts = new Map<string, string>();
  const definitelyRejected = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500;
  const requestId = (key: string) => {
    let id = attempts.get(key);
    if (!id) {
      id = services.createRequestId();
      attempts.set(key, id);
    }
    return id;
  };
  return createDomainStore<LiveGovernanceState>()((set, get) => {
    const data = () =>
      services.client.getQueryData<LiveActivity>(services.queryKey);
    const mutate = async (
      key: string,
      run: (token: string, id: string) => Promise<unknown>,
    ) => {
      const { token, generation, busy } = get();
      if (!token || busy || get().removed) return;
      set({ busy: true, error: "" });
      try {
        await run(token, requestId(key));
        if (get().generation !== generation) return;
        attempts.delete(key);
        await get().refresh();
        if (get().generation === generation)
          set({ selectedId: null, panel: null, kickConfirm: false });
      } catch (error) {
        if (get().generation === generation && definitelyRejected(error))
          attempts.delete(key);
        if (get().generation === generation)
          set({
            error: error instanceof Error ? error.message : "操作失败，请重试",
          });
      } finally {
        if (get().generation === generation) set({ busy: false });
      }
    };
    return {
      ...initial,
      setProposalTarget: (actionId, memberId) =>
        set((s) => ({
          proposalTargets: { ...s.proposalTargets, [actionId]: memberId },
        })),
      bind: (joined) => {
        attempts.clear();
        services.client.removeQueries({
          queryKey: services.queryKey,
          exact: true,
        });
        set({
          ...initial,
          generation: get().generation + 1,
          token: joined.roomToken,
          nameDraft: joined.member.name,
        });
      },
      receive: (event) => {
        if (!get().token) return;
        services.client.setQueryData<LiveActivity>(services.queryKey, (old) => {
          if (old && old.roomSid !== event.roomSid) return old;
          const messages = new Map((old?.messages ?? []).map((m) => [m.id, m]));
          event.messages.forEach((m) => messages.set(m.id, m));
          const latest = old && old.revision > event.revision ? old : event;
          return {
            ...latest,
            sequence: Math.max(old?.sequence ?? 0, event.sequence),
            messages: [...messages.values()]
              .sort((a, b) => a.sequence - b.sequence)
              .slice(-200),
            gap: event.gap || old?.gap || false,
          };
        });
        if (data()?.removed) get().markRemoved();
      },
      refresh: async () => {
        const { token, generation } = get();
        if (!token) return;
        const event = await services.activity(token);
        if (get().generation === generation) get().receive(event);
      },
      setDraft: (draft) => set({ draft }),
      mentionAssistant: () => set(s => /^@AI(?:\s|$)/i.test(s.draft) ? s : s.draft.length > 496 ? { error: "请为 @AI 预留 4 个字符。" } : { draft: `@AI ${s.draft}`, error: "" }),
      select: (selectedId) =>
        set({
          selectedId,
          panel: null,
          kickConfirm: false,
          reason: "",
          error: "",
        }),
      openPanel: (panel) =>
        set({
          panel,
          selectedId: null,
          error: "",
          settingsDraft:
            panel === "settings" && data()
              ? {
                  ...data()!.settings,
                  faq: data()!.settings.faq.map((q) => ({ ...q })),
                  blockedPhrases: [...data()!.settings.blockedPhrases],
                }
              : null,
          nameDraft: data()?.self?.name ?? get().nameDraft,
        }),
      setReason: (reason) => set({ reason }),
      setName: (nameDraft) => set({ nameDraft }),
      setSettings: (patch) =>
        set((s) => ({
          settingsDraft: s.settingsDraft
            ? { ...s.settingsDraft, ...patch }
            : null,
        })),
      confirmKick: (kickConfirm) => set({ kickConfirm }),
      markRemoved: () =>
        set({
          removed: true,
          selectedId: null,
          panel: null,
          error: "你已被移出，本场直播内不可重新进入。",
        }),
      send: async () => {
        const { token, draft, sending, generation } = get();
        const text = draft.trim();
        if (!token || sending || get().removed || !text || text.length > 500)
          return false;
        if (data()?.self?.mute) {
          set({ error: "你已被禁言，暂时无法发送消息。" });
          return false;
        }
        set({ sending: true, error: "" });
        const key = `message:${text}`;
        try {
          const result = await services.send(token, requestId(key), text);
          if (get().generation !== generation) return false;
          attempts.delete(key);
          services.client.setQueryData<LiveActivity>(
            services.queryKey,
            (old) =>
              old
                ? {
                    ...old,
                    messages: [
                      ...old.messages.filter((m) => m.id !== result.message.id),
                      result.message,
                    ]
                      .sort((a, b) => a.sequence - b.sequence)
                      .slice(-200),
                  }
                : old,
          );
          set({ draft: get().draft === draft ? "" : get().draft });
          return true;
        } catch (error) {
          if (get().generation === generation && definitelyRejected(error))
            attempts.delete(key);
          if (get().generation === generation) {
            set({
              error:
                error instanceof Error ? error.message : "消息未发送，请重试",
            });
            void get()
              .refresh()
              .catch(() => {});
          }
          return false;
        } finally {
          if (get().generation === generation) set({ sending: false });
        }
      },
      moderate: (input) =>
        mutate(`moderate:${JSON.stringify(input)}`, (token, id) =>
          services.moderate(token, { ...input, requestId: id }),
        ),
      mentionMember: (memberId) => {
        const current = data();
        const { draft, sending, removed, token } = get();
        const member = current?.members.find((m) => m.id === memberId);
        if (!token || sending || removed || current?.self?.mute || !member ||
            (member.role !== "host" && member.role !== "viewer")) return false;
        const mention = `@${liveMemberLabel(member)}`;
        const next = `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${mention} `;
        if (next.length > 500) {
          set({ error: "消息最多 500 个字符，请删减后再提及用户。" });
          return false;
        }
        set({ draft: next, error: "" });
        return true;
      },
      saveName: () => {
        const name = get().nameDraft.trim();
        if (!name || name.length > 40) {
          set({ error: "昵称需要 1–40 个字符" });
          return Promise.resolve();
        }
        return mutate(`name:${name}`, (token, id) =>
          services.rename(token, id, name),
        );
      },
      saveSettings: () => {
        const draft = get().settingsDraft;
        const settings = draft
          ? {
              ...draft,
              blockedPhrases: draft.blockedPhrases
                .map((p) => p.trim())
                .filter(Boolean),
            }
          : null;
        return settings
          ? mutate(`settings:${JSON.stringify(settings)}`, (token, id) =>
              services.settings(token, id, settings),
            )
          : Promise.resolve();
      },
      clear: () => {
        attempts.clear();
        services.client.removeQueries({
          queryKey: services.queryKey,
          exact: true,
        });
        set({ ...initial, generation: get().generation + 1 });
      },
    };
  });
}
export type LiveGovernanceStore = ReturnType<typeof createLiveGovernanceStore>;
