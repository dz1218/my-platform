import assert from "node:assert/strict";
import test from "node:test";
import { createRoomChat, boundReply } from "../room-chat.js";
import type { RoomTurn } from "../agents/room-assistant.js";

const author = (identity = "viewer_one") => ({ identity, name: identity });
const packet = (text: string, id = Math.random().toString()) => new TextEncoder().encode(JSON.stringify({ v: 1, id, text }));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test("only explicit questions call the model; IDs and trusted participants prevent loops", async () => {
  const calls: RoomTurn[][] = [], replies: string[] = [];
  const chat = createRoomChat({ ask: async messages => { calls.push(messages); return "你好"; }, publish: async p => { replies.push(JSON.parse(new TextDecoder().decode(p)).text); } });
  chat.receive(packet("普通消息"), author());
  chat.receive(packet("@Alice hello"), author());
  chat.receive(packet("@AI hello"), { ...author(), isAgent: true });
  chat.receive(new Uint8Array(5000), author());
  chat.receive(packet("@AI 你好", "same"), author());
  chat.receive(packet("@AI 你好", "same"), author());
  await tick();
  assert.equal(calls.length, 1); assert.deepEqual(replies, ["你好"]);
  chat.receive(packet("@AI 后续", "same"), author("viewer_two"));
  await tick();
  assert.equal(calls[1].length, 3);
  assert.equal(JSON.parse(calls[1][0].content).participantId, "viewer_one");
  assert.equal(JSON.parse(calls[1][2].content).participantId, "viewer_two");
  chat.close();
});

test("sessions isolate context, cap 20 pairs and 16000 characters", async () => {
  const calls: RoomTurn[][] = [];
  const make = () => createRoomChat({ ask: async m => { calls.push(m); return "答".repeat(490); }, publish: async () => {} });
  const first = make();
  for (let i = 0; i < 25; i++) { first.receive(packet(`@AI ${"问".repeat(490)}`), author()); await tick(); }
  assert.ok(calls.every(m => m.length <= 41 && m.reduce((n, x) => n + x.content.length, 0) <= 16000));
  first.close();
  const second = make(); second.receive(packet("@AI 我刚才问了什么"), author()); await tick();
  assert.equal(calls.at(-1)?.length, 1); second.close();
});

test("one pending question per participant and five waiting per room", async () => {
  let release!: (value: string) => void;
  const notices: string[] = [];
  let calls = 0;
  const chat = createRoomChat({ ask: async () => { calls++; return new Promise<string>(r => { release = r; }); }, publish: async (p, destination) => { if (destination) notices.push(JSON.parse(new TextDecoder().decode(p)).text); } });
  chat.receive(packet("@AI 一"), author());
  chat.receive(packet("@AI 二"), author());
  for (let i = 0; i < 6; i++) chat.receive(packet("@AI 排队"), author(`viewer_${i}`));
  await tick(); assert.equal(calls, 1);
  assert.ok(notices.some(n => n.includes("上一个问题")));
  assert.ok(notices.some(n => n.includes("提问较多")));
  chat.close(); release("不该发送"); await tick(); assert.equal(calls, 1);
});

test("timeout releases queue even when a provider ignores cancellation; late answers cannot publish", async () => {
  let resolve!: (value: string) => void;
  const answers: string[] = [];
  const chat = createRoomChat({ timeoutMs: 10, ask: async () => new Promise<string>(r => { resolve = r; }), publish: async p => { answers.push(JSON.parse(new TextDecoder().decode(p)).text); } });
  chat.receive(packet("@AI 超时"), author());
  await new Promise(r => setTimeout(r, 30));
  assert.equal(answers.length, 1); assert.match(answers[0], /超时/);
  resolve("过期回答"); await tick(); assert.equal(answers.length, 1);
  chat.close();
});

test("shutdown aborts generation, drops queued questions and never publishes late results", async () => {
  let resolve!: (value: string) => void, signal!: AbortSignal;
  const answers: unknown[] = [];
  const chat = createRoomChat({ ask: async (_, s) => { signal = s; return new Promise<string>(r => { resolve = r; }); }, publish: async p => { answers.push(p); } });
  chat.receive(packet("@AI 还在吗"), author()); chat.receive(packet("@AI 排队"), author("two"));
  chat.close(); assert.ok(signal.aborted); resolve("晚到回答"); await tick(); assert.deepEqual(answers, []);
  assert.ok(boundReply("😀".repeat(500)).length <= 500);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(boundReply("😀".repeat(500))));
});

test("model failures produce a useful retry message and do not become conversation history", async () => {
  const calls: RoomTurn[][] = [], sent: string[] = [];
  const chat = createRoomChat({ ask: async m => { calls.push(m); if (calls.length === 1) throw Error("provider unavailable"); return "好了"; }, publish: async p => { sent.push(JSON.parse(new TextDecoder().decode(p)).text); } });
  chat.receive(packet("@AI 问题"), author()); await tick();
  chat.receive(packet("@AI 重试"), author()); await tick();
  assert.match(sent[0], /没能回答/); assert.equal(calls[1].length, 1); chat.close();
});

test("slow delivery does not discard a successfully generated public turn", async () => {
  const calls: RoomTurn[][] = [];
  let delivered!: () => void;
  const done = new Promise<void>(resolve => { delivered = resolve; });
  const chat = createRoomChat({ timeoutMs: 10, ask: async m => { calls.push(m); return "回答"; }, publish: async () => { await new Promise(r => setTimeout(r, 20)); delivered(); } });
  chat.receive(packet("@AI 第一个问题"), author());
  await done; await tick();
  chat.receive(packet("@AI 后续问题"), author());
  assert.equal(calls[1].length, 3);
  chat.close();
});
