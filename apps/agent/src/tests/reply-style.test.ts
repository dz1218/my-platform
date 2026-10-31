import { test } from "node:test";
import assert from "node:assert/strict";
import { Usage, type Model } from "@openai/agents";
import { createCompanion } from "../agents/companion.js";
import { promptVersion } from "../prompts/companion-v7.js";
import { recentReplyShape } from "../agents/reply-shape.js";
import { replyInput, type ReplyInput } from "../schemas/plan.js";

const ai = (content: string): ReplyInput["messages"][number] => ({ role: "assistant", source: "AI", content });
const user = (content: string): ReplyInput["messages"][number] => ({ role: "user", source: "USER", content });

test("shape groups actual AI bubbles, counts Unicode and excludes human/unknown provenance", () => {
  assert.deepEqual(recentReplyShape([
    user("hi"), ai("好😀"), ai("你呢？ ”"),
    { role: "assistant", source: "HUMAN", content: "真人消息？" },
    ai("嗯"), { role: "assistant", content: "旧来源不明" }, ai("好"),
  ]), [
    { bubbleCount: 2, characterCount: 7, endsWithQuestion: true },
    { bubbleCount: 1, characterCount: 1, endsWithQuestion: false },
    { bubbleCount: 1, characterCount: 1, endsWithQuestion: false },
  ]);
});

test("only the last four AI runs are summarized; no history is modified", () => {
  const messages = Array.from({ length: 6 }, (_, i) => [user(String(i)), ai("字".repeat(i + 1))]).flat();
  const before = structuredClone(messages);
  assert.deepEqual(recentReplyShape(messages).map((s) => s.characterCount), [3, 4, 5, 6]);
  assert.deepEqual(messages, before);
  assert.deepEqual(recentReplyShape([user("hi")]), []);
});

for (const structured of [true, false]) {
  test(`one model call preserves 1–3 bubbles and silence (structured=${structured})`, async () => {
    for (const count of [1, 2, 3, 0]) {
      let calls = 0;
      const contents = ["这事我倒有点不同的想法。等消息最烦的就是没个准数，容易一会儿又看一眼。\n\n你说投出去没回音，我能理解为什么烦。", "嗯，懂了", "刚才还想到一点：也不用每次都把话收得那么齐。"].slice(0, count);
      const model: Model = {
        async getResponse(request) {
          calls++;
          assert.equal(request.modelSettings.maxTokens, 4096);
          assert.match(JSON.stringify(request.input), /recentReplyShape/);
          assert.match(JSON.stringify(request.input), /HUMAN/);
          return {
            usage: new Usage({ inputTokens: 1, outputTokens: 1 }),
            output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({
              action: count ? "REPLY" : "SILENCE", intent: count ? "chat" : "closure",
              summary: null, memoryProposals: [],
              messages: contents.map((content, i) => ({ clientItemKey: String(i), content, delayMs: 0 })),
            }) }] }],
          };
        },
        async *getStreamedResponse() { throw new Error("unused"); },
      };
      const result = await createCompanion(model, structured)(replyInput.parse({ messages: [
        user("前文"), ai("一条"), ai("补充"),
        { role: "assistant", source: "HUMAN", content: "真人上下文" }, user("新消息"),
      ] }), new AbortController().signal);
      assert.equal(calls, 1);
      assert.equal(result.promptVersion, promptVersion);
      assert.equal(result.messages.length, count);
      assert.deepEqual(result.messages.map(m => m.content), contents);
    }
  });
}

test("context updates use separate instructions and no reply shape while retaining proposals", async () => {
  const proposal = { sourceMessageId: "12", kind: "PREFERENCE", content: "喜欢安静" };
  const model: Model = {
    async getResponse(request) {
      const encoded = JSON.stringify(request);
      assert.match(encoded, /当前任务仅做上下文整理/);
      assert.doesNotMatch(encoded, /recentReplyShape|白得意了|诚实的厨子|节奏示例/);
      assert.match(encoded, /喜欢安静/);
      return {
        usage: new Usage({ inputTokens: 1, outputTokens: 1 }),
        output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({
          action: "SILENCE", intent: "closure", messages: [], summary: "用户表示喜欢安静", memoryProposals: [proposal],
        }) }] }],
      };
    },
    async *getStreamedResponse() { throw new Error("unused"); },
  };
  const result = await createCompanion(model)(replyInput.parse({ kind: "CONTEXT_UPDATE", messages: [{ ...user("喜欢安静"), id: "12" }] }), new AbortController().signal);
  assert.deepEqual(result.memoryProposals, [proposal]);
  assert.deepEqual(result.messages, []);
});

test("JSON-mode blank and malformed candidates get one repair without entering chat history", async () => {
  for (const bad of ["  \n ", '{"action":"REPLY","messages":["invalid-unsent-candidate"]}']) {
    let calls = 0;
    const model: Model = {
      async getResponse(request) {
        const input = JSON.stringify(request.input);
        calls++;
        assert.doesNotMatch(input, /invalid-unsent-candidate/);
        if (calls === 2) assert.match(input, /repair/);
        return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: calls === 1 ? bad : JSON.stringify({ action: "REPLY", intent: "chat", messages: [{ clientItemKey: "1", content: "今天是万圣夜", delayMs: 0 }], summary: null, memoryProposals: [] }) }] }] };
      },
      async *getStreamedResponse() { throw new Error("unused"); },
    };
    const result = await createCompanion(model, false)(replyInput.parse({ messages: [user("今天是什么节日")] }), new AbortController().signal);
    assert.equal(calls, 2);
    assert.equal(result.modelCalls, 2);
    assert.equal(result.messages[0].content, "今天是万圣夜");
  }
});

test("repair is bounded and cancellation or provider failures never start another call", async () => {
  for (const mode of ["invalid", "cancel", "provider"] as const) {
    const controller = new AbortController();
    let calls = 0;
    const model: Model = {
      async getResponse() {
        calls++;
        if (mode === "provider") throw new Error("provider unavailable");
        if (mode === "cancel") controller.abort();
        return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: " " }] }] };
      },
      async *getStreamedResponse() { throw new Error("unused"); },
    };
    await assert.rejects(createCompanion(model, false)(replyInput.parse({ messages: [user("你好")] }), controller.signal));
    assert.equal(calls, mode === "invalid" ? 2 : 1);
  }
});
