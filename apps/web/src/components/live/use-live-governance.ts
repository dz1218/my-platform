"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createLiveGovernanceStore } from "@my-platform/client-core/live/governance";
import type { LiveActivity, LiveRoomMessage } from "@my-platform/shared";
import { useStoreInstance } from "@/stores/use-store-instance";
import { check } from "@/services/api/client";

export function useLiveGovernance(base: string, roomId: string) {
  const client = useQueryClient();
  const queryKey = ["live-activity", base, roomId];
  const request = async <T>(
    path: string,
    token: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const response = await check(
      await fetch(`${base}/rooms/${encodeURIComponent(roomId)}/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Live-Room-Token": token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      }),
    );
    return response.json();
  };
  const store = useStoreInstance(() =>
    createLiveGovernanceStore({
      client,
      queryKey,
      createRequestId: () => crypto.randomUUID(),
      activity: (token) => request<LiveActivity>("activity", token),
      send: (token, requestId, text) =>
        request<{ message: LiveRoomMessage }>("messages", token, "POST", {
          requestId,
          text,
        }),
      moderate: (token, input) => request("moderation", token, "POST", input),
      rename: (token, requestId, name) =>
        request("members/me", token, "PATCH", { requestId, name }),
      settings: (token, requestId, settings) =>
        request("settings", token, "PATCH", { requestId, settings }),
    }),
  );
  const state = useStore(
    store,
    useShallow((s) => ({
      token: s.token,
      removed: s.removed,
      draft: s.draft,
      sending: s.sending,
      busy: s.busy,
      error: s.error,
      selectedId: s.selectedId,
      panel: s.panel,
      kickConfirm: s.kickConfirm,
      reason: s.reason,
      nameDraft: s.nameDraft,
      settingsDraft: s.settingsDraft,
      proposalTargets: s.proposalTargets,
    })),
  );
  const query = useQuery<LiveActivity>({
    queryKey,
    enabled: false,
    queryFn: () => request("activity", store.getState().token),
    gcTime: 0,
  });
  return { store, state, data: query.data, queryKey };
}
export type LiveGovernanceModel = ReturnType<typeof useLiveGovernance>;
