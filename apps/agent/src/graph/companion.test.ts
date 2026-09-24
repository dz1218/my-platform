import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage } from '@langchain/core/messages';
import { createCompanionGraph } from './companion.js';

test('graph uses versioned expression rules and returns a complete reply', async () => {
  const graph = createCompanionGraph({ invoke: async messages => {
    assert.ok(String(messages[0].content).includes('虚构身份'));
    assert.equal(messages.at(-1)?.content, '明天面试');
    return new AIMessage({ content: ' 面试加油，准备得怎么样了？ ', response_metadata: { finish_reason: 'stop' } });
  } });
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
