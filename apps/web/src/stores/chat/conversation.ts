import { createConversationStore as createCoreConversationStore, type ConversationDependencies } from '@my-platform/client-core';
import { createBrowserRequestId } from '@/services/core-adapters';
export { conversationSelectors, mergeConversationMessages, type Turn, type ConversationStore } from '@my-platform/client-core';
export const createConversationStore = (dependencies: Omit<ConversationDependencies, 'createRequestId'>) =>
  createCoreConversationStore({ ...dependencies, createRequestId: createBrowserRequestId });
