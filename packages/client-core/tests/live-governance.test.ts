import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/query-core";
import { createLiveGovernanceStore } from "../src/live/governance";
import type {
  LiveActivity,
  LiveRoomJoin,
  LiveRoomMessage,
  LiveModerationInput,
} from "@my-platform/shared";
const snapshot = (revision = 1): LiveActivity => ({
  type: "room.activity",
  roomId: "room-one",
  roomSid: "RM_one",
  revision,
  sequence: 0,
  members: [],
  messages: [],
  settings: {
    rules: "",
    announcement: "",
    faq: [],
    blockedPhrases: [],
    slowSeconds: 0,
    autoReply: true,
    autoModeration: true,
    welcome: false,
  },
  removed: false,
  gap: false,
  self: { id: "one", name: "听众", code: "ABCD", role: "viewer", online: true },
});
const joined: LiveRoomJoin = {
  token: "media",
  voiceToken: "voice",
  roomToken: "room-token",
  member: snapshot().self!,
  role: "viewer",
  livekitUrl: "ws://local",
  roomId: "room-one",
  identity: "viewer_one",
};
const message: LiveRoomMessage = {
  id: "message-one",
  sequence: 1,
  memberId: "one",
  name: "听众",
  role: "viewer",
  text: "你好",
  time: 1,
};
function fixture(
  send?: (
    token: string,
    id: string,
    text: string,
  ) => Promise<{ message: LiveRoomMessage }>,
  moderate: (token: string, input: LiveModerationInput) => Promise<unknown> = async () => {},
) {
  const client = new QueryClient();
  const queryKey = ["live-activity", "room-one"];
  let counter = 0;
  const store = createLiveGovernanceStore({
    client,
    queryKey,
    createRequestId: () => `request-${++counter}`,
    activity: async () => snapshot(),
    send: send ?? (async () => ({ message })),
    moderate,
    rename: async () => {},
    settings: async () => {},
  });
  store.getState().bind(joined);
  store.getState().receive(snapshot());
  return { client, queryKey, store };
}
test("lost send response retries with the same id and server events deduplicate", async () => {
  const ids: string[] = [];
  const f = fixture(async (_token, id) => {
    ids.push(id);
    if (ids.length === 1) throw Error("lost");
    return { message };
  });
  const a = f.store.getState();
  a.setDraft("你好");
  assert.equal(await a.send(), false);
  assert.equal(await a.send(), true);
  assert.equal(ids[0], ids[1]);
  a.receive({ ...snapshot(), sequence: 1, messages: [message] });
  assert.equal(
    f.client.getQueryData<LiveActivity>(f.queryKey)?.messages.length,
    1,
  );
  assert.equal(f.store.getState().draft, "");
  f.client.clear();
});

test("member mentions are ordinary text, preserve drafts and never imply moderation", async () => {
  const sent: string[] = [];
  let moderationCalls = 0;
  const f = fixture(async (_token, _id, text) => {
    sent.push(text);
    return { message: { ...message, text } };
  }, async () => { moderationCalls++; });
  const current = snapshot(2);
  current.members = [
    { ...current.self!, id: "target", name: "听众", code: "FE7A" },
    { ...current.self!, id: "other", name: "听众", code: "ABCD" },
    { ...current.self!, id: "host", name: "主播", code: "HOST", role: "host" },
  ];
  const a = f.store.getState();
  a.receive(current);
  assert.equal(a.mentionMember("target"), true);
  assert.equal(f.store.getState().draft, "@听众·FE7A ");
  a.setDraft(f.store.getState().draft + "收到你的消息");
  assert.deepEqual(sent, []);
  assert.equal(moderationCalls, 0);
  assert.equal(await a.send(), true);
  assert.deepEqual(sent, ["@听众·FE7A 收到你的消息"]);
  a.mentionMember("host");
  assert.equal(f.store.getState().draft, "@主播·HOST ");
  a.setDraft("@AI 禁言");
  a.mentionMember("target");
  assert.equal(f.store.getState().draft, "@AI 禁言 @听众·FE7A ");
  a.setDraft("@AI 禁言 @听众·FE7A 30分钟");
  a.mentionMember("other");
  assert.equal(f.store.getState().draft, "@AI 禁言 @听众·FE7A 30分钟 @听众·ABCD ");
  a.setDraft("这是一条普通回复 ");
  a.mentionMember("target");
  assert.equal(f.store.getState().draft, "这是一条普通回复 @听众·FE7A ");
  current.members[0].name = "新昵称";
  a.receive({ ...current, revision: 3 });
  a.setDraft("");
  a.mentionMember("target");
  assert.equal(f.store.getState().draft, "@新昵称·FE7A ");
  a.setDraft("字".repeat(500));
  assert.equal(a.mentionMember("target"), false);
  assert.equal(f.store.getState().draft.length, 500);
  assert.ok(f.store.getState().error);
  assert.equal(a.mentionMember("missing"), false);
  a.clear();
  assert.equal(a.mentionMember("target"), false);
  f.client.clear();
});
test("older snapshots cannot clear a newer restriction and stale removal is ignored", () => {
  const f = fixture();
  const muted = snapshot(3);
  muted.self!.mute = { actionId: "mute-three", until: 0, reason: "刷屏" };
  f.store.getState().receive(muted);
  f.store.getState().receive({ ...snapshot(2), removed: true });
  assert.equal(
    f.client.getQueryData<LiveActivity>(f.queryKey)?.self?.mute?.actionId,
    "mute-three",
  );
  assert.equal(f.store.getState().removed, false);
  f.client.clear();
});
test("room changes fence late send completions and clear sensitive room state", async () => {
  let resolve!: (v: { message: LiveRoomMessage }) => void;
  const f = fixture(
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  f.store.getState().setDraft("你好");
  const sent = f.store.getState().send();
  f.store.getState().bind({ ...joined, roomToken: "different-token" });
  resolve({ message });
  assert.equal(await sent, false);
  assert.equal(f.client.getQueryData(f.queryKey), undefined);
  f.store.getState().clear();
  assert.equal(f.store.getState().token, "");
  f.client.clear();
});
test("an explicitly rejected send can be retried as a new attempt after cooldown", async () => {
  const ids: string[] = [];
  const f = fixture(async (_token, id) => {
    ids.push(id);
    if (ids.length === 1)
      throw Object.assign(new Error("slow mode"), { status: 429 });
    return { message };
  });
  f.store.getState().setDraft("你好");
  assert.equal(await f.store.getState().send(), false);
  assert.equal(await f.store.getState().send(), true);
  assert.notEqual(ids[0], ids[1]);
  f.client.clear();
});

test("mention preserves the draft and cannot overflow the server limit", () => {
  const f = fixture();
  const a = f.store.getState();
  a.setDraft("我的问题"); a.mentionAssistant(); a.mentionAssistant();
  assert.equal(f.store.getState().draft, "@AI 我的问题");
  a.setDraft("问".repeat(500)); a.mentionAssistant();
  assert.equal(f.store.getState().draft.length, 500);
  assert.ok(f.store.getState().error);
  f.client.clear();
});
test("server event history is bounded and new membership clears old drafts and cache", () => {
  const f = fixture();
  f.store.getState().receive({ ...snapshot(), messages: Array.from({length: 205}, (_, i) => ({...message, id: String(i), sequence: i + 1})) });
  assert.equal(f.client.getQueryData<LiveActivity>(f.queryKey)?.messages.length, 200);
  f.store.getState().setDraft("房间草稿");
  f.store.getState().bind(joined);
  assert.equal(f.store.getState().draft, "");
  assert.equal(f.client.getQueryData(f.queryKey), undefined);
  f.client.clear();
});
