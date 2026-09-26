import { conversationV2 } from './conversation-v2.js';
import { conversationV1 } from './conversation-v1.js';
export function getPrompt(version: string) {
  if (version === conversationV2.version) return conversationV2;
  if (version === conversationV1.version) return conversationV1;
  throw new Error(`Unknown prompt version: ${version}`);
}
