import { setTimeout as delay } from "node:timers/promises";
import type { z } from "zod";
import { roomMetadata } from "./room-config.js";
import {
  roomActivitySchema,
  roomHistoryPageSchema,
  type RoomHistoryQuery,
  type RoomActivity,
  type RoomAssistantOutput,
} from "./room-governance.js";

export function createRoomAPI(
  api: string,
  token: string,
  metadata: z.infer<typeof roomMetadata>,
  signal: AbortSignal,
) {
  const base = `${api.replace(/\/$/, "")}/internal/live/rooms/${encodeURIComponent(metadata.roomId)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Live-Room-Sid": metadata.roomSid,
    "X-Live-Assistant-Session": metadata.sessionId,
  };
  return {
    async history(query: RoomHistoryQuery, requestSignal: AbortSignal) {
      const params = new URLSearchParams({
        through: String(query.through),
        limit: String(query.limit),
      });
      if (query.query) params.set("query", query.query);
      if (query.member) params.set("member", query.member);
      if (query.before !== null) params.set("before", String(query.before));
      const response = await fetch(`${base}/history?${params}`, {
        headers,
        signal: AbortSignal.any([
          signal,
          requestSignal,
          AbortSignal.timeout(10000),
        ]),
      });
      if (!response.ok) throw new Error(`room_history_${response.status}`);
      return roomHistoryPageSchema.parse(await response.json());
    },
    async output(value: RoomAssistantOutput) {
      const response = await fetch(`${base}/output`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(value),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw new Error(`room_output_${response.status}`);
      return response.json();
    },
    async listen(receive: (snapshot: RoomActivity) => void) {
      let after = 0,
        attempts = 0;
      while (!signal.aborted) {
        try {
          const response = await fetch(`${base}/events?after=${after}`, {
            headers,
            signal,
          });
          if (response.status === 401 || response.status === 409) {
            console.warn(
              JSON.stringify({
                event: "room_events_session_ended",
                sessionId: metadata.sessionId,
                status: response.status,
              }),
            );
            return;
          }
          if (!response.ok || !response.body)
            throw new Error("room_events_unavailable");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = "";
          try {
            while (!signal.aborted) {
              const { value, done } = await reader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              if (pending.length > 4 * 1024 * 1024)
                throw new Error("room_event_too_large");
              let boundary;
              while ((boundary = pending.indexOf("\n\n")) >= 0) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                if (!frame.startsWith("data: ")) continue;
                const event = roomActivitySchema.parse(
                  JSON.parse(frame.slice(6)),
                );
                if (
                  event.roomSid !== metadata.roomSid ||
                  event.sessionId !== metadata.sessionId
                )
                  throw new Error("room_session_changed");
                receive(event);
                after = Math.max(after, event.sequence);
                attempts = 0;
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        } catch (error) {
          if (signal.aborted) return;
          console.warn(
            JSON.stringify({
              event: "room_events_retry",
              sessionId: metadata.sessionId,
              attempt: attempts,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
        await delay(Math.min(1000 * 2 ** attempts++, 15000), undefined, {
          signal,
        }).catch(() => {});
      }
    },
  };
}
