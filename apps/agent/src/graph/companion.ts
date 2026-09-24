import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { getPrompt } from '../prompts/index.js';

export const replyInput = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1).max(20000) })).min(2).max(41),
}).strict();
export type ReplyInput = z.infer<typeof replyInput>;
export interface ChatModel { invoke(messages: BaseMessage[], config?: RunnableConfig): Promise<AIMessage> }
const State = Annotation.Root({
  messages: Annotation<ReplyInput['messages']>(),
  prepared: Annotation<BaseMessage[]>(),
  content: Annotation<string>(),
  promptVersion: Annotation<string>(),
});
export function createCompanionGraph(model: ChatModel, version = 'conversation-v1') {
  const prompt = getPrompt(version);
  const template = ChatPromptTemplate.fromMessages([
    ['system', '{expressionRules}'], new MessagesPlaceholder('conversation'),
  ]);
  return new StateGraph(State)
    .addNode('prepare_context', async state => {
      const input = replyInput.parse({ messages: state.messages });
      const conversation = input.messages.map(message => message.role === 'system' ? new SystemMessage(message.content) : message.role === 'user' ? new HumanMessage(message.content) : new AIMessage(message.content));
      return { prepared: await template.formatMessages({ expressionRules: prompt.text, conversation }), promptVersion: prompt.version };
    })
    .addNode('compose_reply', async (state, config) => {
      // invoke returns a whole reply; no token streaming across any service boundary.
      const result = await model.invoke(state.prepared, config);
      const reason = result.response_metadata?.finish_reason;
      if (reason && reason !== 'stop') throw new Error('Incomplete model response');
      if (result.tool_calls?.length) throw new Error('Unexpected tool call');
      const content = typeof result.content === 'string' ? result.content : result.content.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');
      return { content };
    })
    .addNode('validate_reply', state => {
      const content = state.content.trim();
      if (!content || Buffer.byteLength(content, 'utf8') > 32000) throw new Error('Invalid reply length');
      return { content };
    })
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'compose_reply')
    .addEdge('compose_reply', 'validate_reply')
    .addEdge('validate_reply', END)
    .compile();
}
