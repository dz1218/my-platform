import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { getPrompt } from '../prompts/index.js';

export const replyInput = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1).max(20000) })).min(2).max(41),
  allowWait: z.boolean().default(false),
  maxWaitSeconds: z.number().int().min(0).max(30).default(0),
  pendingSeconds: z.number().int().nonnegative().default(0),
}).strict();
const plannedReply = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), content: z.string().min(1) }).strict(),
  z.object({ action: z.literal('wait'), waitSeconds: z.number().int().min(1).max(30) }).strict(),
]);
export type ReplyInput = z.infer<typeof replyInput>;
export interface ChatModel { invoke(messages: BaseMessage[], config?: RunnableConfig): Promise<AIMessage> }
const State = Annotation.Root({
  messages: Annotation<ReplyInput['messages']>(),
  prepared: Annotation<BaseMessage[]>(),
  content: Annotation<string>(),
  action: Annotation<string>(),
  waitSeconds: Annotation<number>(),
  allowWait: Annotation<boolean>(),
  maxWaitSeconds: Annotation<number>(),
  pendingSeconds: Annotation<number>(),
  promptVersion: Annotation<string>(),
});
export function createCompanionGraph(model: ChatModel, version = 'conversation-v2') {
  const prompt = getPrompt(version);
  const template = ChatPromptTemplate.fromMessages([
    ['system', '{expressionRules}'], new MessagesPlaceholder('conversation'),
  ]);
  return new StateGraph(State)
    .addNode('prepare_context', async state => {
      const input = replyInput.parse({ messages: state.messages, allowWait: state.allowWait, maxWaitSeconds: state.maxWaitSeconds, pendingSeconds: state.pendingSeconds });
      const conversation = input.messages.map(message => message.role === 'system' ? new SystemMessage(message.content) : message.role === 'user' ? new HumanMessage(message.content) : new AIMessage(message.content));
      return { allowWait: input.allowWait, maxWaitSeconds: input.maxWaitSeconds, pendingSeconds: input.pendingSeconds, prepared: await template.formatMessages({ expressionRules: prompt.text + `\n执行约束：allowWait=${input.allowWait}, maxWaitSeconds=${input.maxWaitSeconds}, 距用户最后一条消息已过去约 ${input.pendingSeconds} 秒。`, conversation }), promptVersion: prompt.version };
    })
    .addNode('compose_reply', async (state, config) => {
      // The validated whole reply is delivered in an SSE reply event.
      const result = await model.invoke(state.prepared, config);
      const reason = result.response_metadata?.finish_reason;
      if (reason && reason !== 'stop') throw new Error('Incomplete model response');
      if (result.tool_calls?.length) throw new Error('Unexpected tool call');
      const content = typeof result.content === 'string' ? result.content : result.content.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');
      return { content };
    })
    .addNode('validate_reply', state => {
      const plan = version === 'conversation-v2' ? plannedReply.parse(JSON.parse(state.content)) : { action: 'reply' as const, content: state.content };
      if (plan.action === 'wait') {
        if (!state.allowWait || plan.waitSeconds > state.maxWaitSeconds) throw new Error('Wait exceeds execution limits');
        return { action: 'wait', waitSeconds: plan.waitSeconds, content: '' };
      }
      const content = plan.content.trim();
      if (!content || Buffer.byteLength(content, 'utf8') > 32000) throw new Error('Invalid reply length');
      return { content, action: 'reply', waitSeconds: 0 };
    })
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'compose_reply')
    .addEdge('compose_reply', 'validate_reply')
    .addEdge('validate_reply', END)
    .compile();
}
