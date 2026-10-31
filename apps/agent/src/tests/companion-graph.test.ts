import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promptVersion } from '../prompts/companion-v7.js';
import { MemorySaver } from '@langchain/langgraph';
import { runGraph, type GraphServices } from '../companion/graph.js';
import { Checkpoints, type Budget } from '../companion/checkpoints.js';
import { replyInput } from '../schemas/plan.js';
import type { Usage } from '../schemas/runtime.js';
import { assertReleaseReport } from '../companion/release-gate.js';
import { graphVersion } from '../companion/checkpoints.js';

const plan = { action: 'REPLY', intent: 'chat', messages: [{ clientItemKey: '1', content: '记得，你说过喜欢咖啡。', delayMs: 0 }], summary: null, memoryProposals: [] };
function input(memory = true) {
  return replyInput.parse({ contractVersion: 2, run: { id: 'a'.repeat(64), claimToken: 'secret-claim', conversationId: `test-${Math.random()}`, userId: 'user-a', identityId: 'role-a', settingsVersion: 1, turnVersion: 1, memoryRevision: 1, throughMessageId: '1', inputHash: 'b'.repeat(64), deadline: new Date(Date.now() + 90_000).toISOString(), memoryEnabled: memory }, messages: [{ role: 'system', content: '{"identity":{"name":"林晚"},"memories":[]}' }, { role: 'user', id: '1', content: '我喜欢喝什么？', source: 'USER' }] });
}
function budget(): Budget {
  const usage: Usage = { modelCalls: 0, retrievalCalls: 0, inputTokens: 0, outputTokens: 0 };
  return { reserve: async kind => { const field = kind === 'model' ? 'modelCalls' : 'retrievalCalls'; if (usage[field] >= (kind === 'model' ? 3 : 2)) throw new Error('execution_budget_exceeded'); usage[field]++; }, usage: async (i, o) => { usage.inputTokens += i; usage.outputTokens += o; }, stats: async () => ({ ...usage }) };
}
const services = (outputs: string[]): GraphServices => ({
  verify: async () => {}, retrieve: async () => [{ id: 'coffee', kind: 'memory', version: 1, hash: 'hash', content: '我喜欢咖啡' }],
  model: async (_system, data) => { assert.doesNotMatch(data, /secret-claim|claimToken|conversationId/); const text = outputs.shift(); if (text === undefined) throw new Error('unexpected_model_call'); return { text, inputTokens: 20, outputTokens: 10 }; },
});
test('bounded supplementary retrieval and one schema repair produce an attributed candidate', async () => {
  const b = budget();
  const result = await runGraph(input(), new AbortController().signal, services([JSON.stringify({ action: 'RETRIEVE', query: '饮料偏好' }), '{invalid', JSON.stringify(plan)]), b);
  assert.equal(result.execution.modelCalls, 3); assert.equal(result.execution.retrievalCalls, 2);
  assert.deepEqual(result.execution.evidence, [{ id: 'coffee', kind: 'memory', version: 1, hash: 'hash' }]);
  assert.equal(result.execution.inputTokens, 60);
});
test('memory opt-out forbids all retrieval and repeated malformed output is an error, never silence', async () => {
  const deps = services(['bad', 'bad']); deps.retrieve = async () => { throw new Error('privacy violation'); };
  const b = budget(); await assert.rejects(runGraph(input(false), new AbortController().signal, deps, b), /invalid_model_plan/);
  assert.equal((await b.stats()).retrievalCalls, 0);
});
test('checkpoint replay does not call the model again and never persists authorization credentials', async () => {
  const saver = new MemorySaver(), request = input(), b = budget(), deps = services([JSON.stringify(plan)]);
  await runGraph(request, new AbortController().signal, deps, b, saver, 'thread');
  const result = await runGraph(request, new AbortController().signal, deps, b, saver, 'thread');
  assert.equal(result.execution.modelCalls, 1);
  assert.doesNotMatch(JSON.stringify(await saver.getTuple({ configurable: { thread_id: 'thread' } })), /secret-claim|claimToken/);
  deps.verify = async () => { throw new Error('stale_agent_run'); };
  await assert.rejects(runGraph(request, new AbortController().signal, deps, b, saver, 'thread'), /stale_agent_run/);
});
test('cancellation and authorization failures cannot degrade into a candidate', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runGraph(input(), controller.signal, services([]), budget()));
  const deps = services([]); deps.verify = async () => { throw new Error('stale_agent_run'); };
  await assert.rejects(runGraph(input(), new AbortController().signal, deps, budget()), /stale_agent_run/);
});
test('release gates reject unmeasured or mismatched production quality', () => {
  const report = { graphVersion, promptVersion, model: 'fixture', indexVersion: 'fixture:1024:hybrid-v1', datasetHash: 'a'.repeat(64), generatedAt: new Date().toISOString(), retrievalRecallAt6: .95, retrievalUsesRealEmbedding: true, automaticMemoryPrecision: .99, criticalSafetyPassed: true, humanBaseline: 4, humanGraph: 4, modelFailures: 0 };
  assertReleaseReport(report, 'fixture', report.indexVersion);
  for (const change of [{ retrievalRecallAt6: null }, { retrievalUsesRealEmbedding: false }, { automaticMemoryPrecision: .97 }, { criticalSafetyPassed: false }, { humanGraph: 3 }, { modelFailures: 1 }, { graphVersion: 'old' }]) assert.throws(() => assertReleaseReport({ ...report, ...change }, 'fixture', report.indexVersion));
});
test('PostgreSQL survives a new runtime, accounts for failed calls, and purges only the requested relationship', { skip: !process.env.TEST_AGENT_DATABASE_URL }, async () => {
  const url = process.env.TEST_AGENT_DATABASE_URL!;
  const first = new Checkpoints(url), request = input(); let thread = '';
  await first.migrate();
  try {
    await assert.rejects(first.withRun(request.run!, async (id, b) => {
      thread = id;
      const deps = services([]); deps.model = async () => { throw new Error('provider_offline'); };
      return runGraph(request, new AbortController().signal, deps, b, first.saver, id);
    }), /provider_offline/);
  } finally { await first.close(); }
  const restarted = new Checkpoints(url);
  try {
    const result = await restarted.withRun(request.run!, (id, b) => runGraph(request, new AbortController().signal, services([JSON.stringify(plan)]), b, restarted.saver, id));
    assert.equal(result.execution.modelCalls, 2);
    assert.equal(result.execution.retrievalCalls, 1);
    const other = input(); await restarted.withRun(other.run!, async () => {});
    let release!: () => void; let entered!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const execution = restarted.withRun(request.run!, async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
    await locked;
    assert.equal(await restarted.purge(request.run!.conversationId, 2), false);
    await assert.rejects(restarted.withRun(request.run!, async () => {}), /run_busy/);
    release(); await execution;
    assert.equal(await restarted.purge(request.run!.conversationId, 2), true);
    assert.equal(await restarted.saver.getTuple({ configurable: { thread_id: thread } }), undefined);
    assert.equal((await restarted.pool.query('SELECT count(*) FROM companion_runtime.runs WHERE conversation_id=$1', [other.run!.conversationId])).rows[0].count, '1');
    await restarted.purge(other.run!.conversationId, 2);
  } finally { await restarted.close(); }
});
