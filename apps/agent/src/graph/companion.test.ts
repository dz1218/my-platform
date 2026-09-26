import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage } from '@langchain/core/messages';
import { createCompanionGraph } from './companion.js';

test('graph uses versioned expression rules and returns a complete reply', async () => {
  const graph = createCompanionGraph({ invoke: async messages => {
    assert.ok(String(messages[0].content).includes('虚构身份'));
    assert.equal(messages.at(-1)?.content, '明天面试');
    return new AIMessage({ content: ' 面试加油，准备得怎么样了？ ', response_metadata: { finish_reason: 'stop' } });
  } }, 'conversation-v1');
  const result = await graph.invoke({ messages: [{ role: 'system', content: '姓名：林晚' }, { role: 'user', content: '明天面试' }] });
  assert.equal(result.content, '面试加油，准备得怎么样了？');
  assert.equal(result.promptVersion, 'conversation-v1');
});
test('empty and truncated responses fail instead of being sent', async () => {
  for (const message of [new AIMessage(''), new AIMessage({ content: 'partial', response_metadata: { finish_reason: 'length' } })]) {
    const graph = createCompanionGraph({ invoke: async () => message });
    await assert.rejects(graph.invoke({ messages: [{ role: 'system', content: 'identity' }, { role: 'user', content: 'hi' }] }));
  }
});
test('unknown prompt versions fail at startup', () => {
  assert.throws(() => createCompanionGraph({ invoke: async () => new AIMessage('hi') }, 'missing'));
});


const input = { messages: [{ role: 'system' as const, content: '姓名：林晚' }, { role: 'user' as const, content: '还有一件事想说' }] };
test('agent returns a reply action with natural paragraphs', async () => {
  const graph = createCompanionGraph({ invoke: async messages => {
    assert.match(String(messages[0].content), /你决定下一步/);
    assert.match(String(messages[0].content), /allowWait=false/);
    return new AIMessage(JSON.stringify({ action: 'reply', content: '嗯，我听着。\n\n你慢慢说。' }));
  } });
  const result = await graph.invoke(input);
  assert.equal(result.action, 'reply');
  assert.equal(result.content, '嗯，我听着。\n\n你慢慢说。');
});
test('agent chooses a bounded wait without generating a held-back reply', async () => {
  const graph = createCompanionGraph({ invoke: async () => new AIMessage('{"action":"wait","waitSeconds":5}') });
  const result = await graph.invoke({ ...input, allowWait: true, maxWaitSeconds: 10, pendingSeconds: 2 });
  assert.equal(result.action, 'wait'); assert.equal(result.waitSeconds, 5); assert.equal(result.content, '');
  await assert.rejects(graph.invoke({ ...input, allowWait: false, maxWaitSeconds: 10 }));
  await assert.rejects(graph.invoke({ ...input, allowWait: true, maxWaitSeconds: 3 }));
});
test('invalid actions cannot leak into chat', async () => {
  for (const content of ['not JSON', '{"action":"reply","content":" "}', '{"action":"wait","waitSeconds":1.5}', '{"action":"wait","waitSeconds":5,"content":"hidden draft"}', '{"action":"unknown"}']) {
    const graph = createCompanionGraph({ invoke: async () => new AIMessage(content) });
    await assert.rejects(graph.invoke({ ...input, allowWait: true, maxWaitSeconds: 10 }));
  }
});
