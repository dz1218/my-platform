import { RoomConnectionState as ConnectionState } from '@my-platform/shared';
import type { StateCreator } from 'zustand/vanilla';
import type { LiveRoomStore } from '../store';

import type { MediaErrorMessage } from '../../../contracts';
type Device = 'camera' | 'microphone';
type MediaSnapshot = { cameraEnabled: boolean; microphoneEnabled: boolean };
export type RoomOperations = {
  dispatchAgent: () => Promise<void>;
  toggleMedia: (device: Device, control: () => Promise<MediaSnapshot | null>) => Promise<void>;
};
export type RoomServices = { dispatch: () => Promise<void>; mediaError: MediaErrorMessage };
export const createRoomOperations = (services: RoomServices): StateCreator<LiveRoomStore, [['zustand/subscribeWithSelector', never]], [], RoomOperations> => (set, get) => ({
  dispatchAgent: async () => {
    const s = get();
    if (s.role !== '主播' || s.connectionState !== ConnectionState.Connected || s.isDispatchingAgent || s.agentRequested || s.participants.some(p => p.role === 'AI助手')) return;
    const version = s.sessionVersion;
    set({ isDispatchingAgent: true, error: null });
    try {
      await services.dispatch();
      if (get().sessionVersion === version) set({ agentRequested: true });
    } catch (error) {
      if (get().sessionVersion === version) set({ error: error instanceof Error ? error.message : '派发 AI 助手失败' });
    } finally {
      if (get().sessionVersion === version) set({ isDispatchingAgent: false });
    }
  },
  toggleMedia: async (device, control) => {
    const s = get();
    if (s.role !== '主播' || s.connectionState !== ConnectionState.Connected || s.mediaBusy) return;
    const version = s.sessionVersion;
    set({ mediaBusy: device, error: null });
    try {
      const media = await control();
      if (media && get().sessionVersion === version) set(media);
    } catch (error) {
      if (get().sessionVersion === version) set({ error: services.mediaError(error, device) });
    } finally {
      if (get().sessionVersion === version) set({ mediaBusy: null });
    }
  },
});
