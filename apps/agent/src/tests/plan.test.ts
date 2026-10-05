import { test } from "node:test";
import assert from "node:assert/strict";
import { Usage, type Model } from "@openai/agents";
import { createCompanion } from "../agents/companion.js";
import { candidatePlan, replyInput, parseModelPlan } from "../schemas/plan.js";
const item = { clientItemKey: "1", content: "听到了", delayMs: 0 };
test("missing advisory timing defaults to zero without repairing invalid content or actions", () => {
  const raw = { action: "REPLY", intent: "chat", messages: [{ clientItemKey: "1", content: "自然回复" }] };
  assert.equal(parseModelPlan(JSON.stringify(raw)).messages[0].delayMs, 0);
  assert.equal("delayMs" in raw.messages[0], false);
  for (const invalid of [
    { ...raw, action: "wait" },
    { ...raw, messages: [] },
    { ...raw, messages: [{ ...raw.messages[0], content: " " }] },
    { ...raw, messages: [{ ...raw.messages[0], delayMs: null }] },
    { ...raw, messages: [{ ...raw.messages[0], delayMs: -1 }] },
    { ...raw, messages: [raw.messages[0], raw.messages[0]] },
  ]) assert.throws(() => parseModelPlan(invalid));
  assert.throws(() => parseModelPlan("   \n"), /Incomplete model response/);
});
test("V206/V207: silence, counts, unique keys and budgets", () => {
  for (let n = 0; n <= 3; n++)
    assert.ok(
      candidatePlan.safeParse({
        action: n ? "REPLY" : "SILENCE",
        intent: "chat",
        messages: Array.from({ length: n }, (_, i) => ({
          ...item,
          clientItemKey: String(i),
        })),
      }).success,
    );
  for (const messages of [
    [item, item],
    [{ ...item, content: " " }],
    [{ ...item, delayMs: -1 }],
    [{ ...item, content: "长".repeat(501) }],
  ])
    assert.equal(
      candidatePlan.safeParse({ action: "REPLY", intent: "chat", messages })
        .success,
      false,
    );
  assert.equal(
    candidatePlan.safeParse({
      action: "SILENCE",
      intent: "closure",
      messages: [item],
    }).success,
    false,
  );
});
test("single SDK Agent preserves the supplied history as data and validates final output", async () => {
  let calls = 0;
  const model: Model = {
    async getResponse(request) {
      calls++;
      assert.match(JSON.stringify(request.input), /第二条补充/);
      assert.match(JSON.stringify(request.input), /HUMAN/);
      return {
        usage: new Usage({ inputTokens: 10, outputTokens: 10 }),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  summary: null,
                  memoryProposals: [],
                  action: "REPLY",
                  intent: "chat",
                  messages: [item],
                }),
              },
            ],
          },
        ],
      };
    },
    async *getStreamedResponse() {
      throw new Error("streaming not used");
    },
  };
  const run = createCompanion(model);
  const input = replyInput.parse({
    messages: [
      { role: "system", content: "虚拟设定" },
      { role: "assistant", source: "HUMAN", content: "真人历史" },
      { role: "user", content: "第一条" },
      { role: "user", content: "第二条补充" },
    ],
  });
  const result = await run(input, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(result.messages[0].content, item.content);
});
