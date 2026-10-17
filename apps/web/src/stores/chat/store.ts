import { createChatStore as createCoreChatStore } from '@my-platform/client-core';
import { browserMessageHistory } from '@/services/core-adapters';
export type { ChatStore } from '@my-platform/client-core';
export const createChatStore = () => createCoreChatStore({ history: browserMessageHistory });
