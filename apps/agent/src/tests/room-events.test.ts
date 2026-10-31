import assert from "node:assert/strict";
import test from "node:test";
import { createRoomAPI } from "../room-events.js";

const metadata = {
  roomId: "room-test",
  roomSid: "RM_test",
  sessionId: "assistant-session-test",
  deadline: Date.now() + 10000,
};
const query = {
  query: "之前 100%_",
  member: "听众·FE7A",
  before: 20,
  through: 30,
  limit: 10,
};

test("history transport binds queries to the room session and keeps pagination intact", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/internal/live/rooms/room-test/history");
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      through: "30", limit: "10", query: "之前 100%_", member: "听众·FE7A", before: "20",
    });
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-room-token");
    assert.equal(headers.get("X-Live-Room-Sid"), metadata.roomSid);
    assert.equal(headers.get("X-Live-Assistant-Session"), metadata.sessionId);
    return Response.json({ messages: [], nextBefore: 15 });
  });
  const api = createRoomAPI("https://api.test", "test-room-token", metadata, new AbortController().signal);
  assert.deepEqual(await api.history(query, new AbortController().signal), {
    messages: [], nextBefore: 15,
  });
});

test("removal and generation cancellation both abort a history request", async (t) => {
  for (const cancel of ["room", "generation"]) {
    let requestSignal: AbortSignal | null | undefined;
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      requestSignal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    });
    const lifetime = new AbortController();
    const generation = new AbortController();
    const api = createRoomAPI("https://api.test", "test-room-token", metadata, lifetime.signal);
    const request = api.history(query, generation.signal);
    (cancel === "room" ? lifetime : generation).abort();
    await assert.rejects(request, /cancelled/);
    assert.equal(requestSignal?.aborted, true);
    t.mock.restoreAll();
  }
});

test("history read failures are not converted into an empty transcript", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 409 }));
  const api = createRoomAPI("https://api.test", "test-room-token", metadata, new AbortController().signal);
  await assert.rejects(api.history(query, new AbortController().signal), /room_history_409/);
});
