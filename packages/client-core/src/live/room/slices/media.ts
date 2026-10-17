import type { StateCreator } from 'zustand/vanilla';
import type { LiveRoomStore } from '../store';
import type { LiveRoomState } from '../initial-state';

export type MediaActions = {
  setMediaBusy: (value: LiveRoomState['mediaBusy']) => void;
  setCameraEnabled: (value: LiveRoomState['cameraEnabled']) => void;
  setMicrophoneEnabled: (value: LiveRoomState['microphoneEnabled']) => void;
  setAudioBlocked: (value: LiveRoomState['audioBlocked']) => void;
};
export const createMediaSlice: StateCreator<LiveRoomStore, [], [], MediaActions> = (set) => ({
  setMediaBusy: (mediaBusy) => set({ mediaBusy }),
  setCameraEnabled: (cameraEnabled) => set({ cameraEnabled }),
  setMicrophoneEnabled: (microphoneEnabled) => set({ microphoneEnabled }),
  setAudioBlocked: (audioBlocked) => set({ audioBlocked }),
});
