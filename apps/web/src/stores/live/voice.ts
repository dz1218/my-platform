import { createLiveVoiceStore as createCoreLiveVoiceStore } from '@my-platform/client-core';
import { createBrowserRequestId } from '@/services/core-adapters';
export { liveVoiceSelectors, type VoiceSlot, type VoiceState, type VoiceAction, type Device, type LiveVoiceStore, type VoiceTransport } from '@my-platform/client-core';
export const createLiveVoiceStore = () => createCoreLiveVoiceStore({ createRequestId: createBrowserRequestId });
