import { createLiveChatStore as createCoreLiveChatStore } from '@my-platform/client-core';
import { browserLiveChatCodec, createBrowserRequestId } from '@/services/core-adapters';
export { liveChatSelectors, liveChatTopic, liveChatMaxLength, type LiveMessage, type LiveChatStore } from '@my-platform/client-core';
export const createLiveChatStore = () => createCoreLiveChatStore({ createRequestId: createBrowserRequestId, codec: browserLiveChatCodec });
