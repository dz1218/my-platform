import { conversationV1 } from './conversation-v1.js';
export function getPrompt(version: string) {
  if (version === conversationV1.version) return conversationV1;
  throw new Error(`Unknown prompt version: ${version}`);
}
