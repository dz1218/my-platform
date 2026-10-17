import type { StateCreator } from 'zustand/vanilla';
import type { LiveRoomStore } from '../store';
import type { LiveRoomState } from '../initial-state';

export type SessionActions = {
  setRole: (value: LiveRoomState['role']) => void;
  setRoomNotice: (value: LiveRoomState['roomNotice']) => void;
  setNickname: (value: LiveRoomState['nickname']) => void;
  setConnectionState: (value: LiveRoomState['connectionState']) => void;
  setParticipants: (value: LiveRoomState['participants']) => void;
  setError: (value: LiveRoomState['error']) => void;
  setIsJoining: (value: LiveRoomState['isJoining']) => void;
  setIsDispatchingAgent: (value: LiveRoomState['isDispatchingAgent']) => void;
  setAgentRequested: (value: LiveRoomState['agentRequested']) => void;
  setVoiceToken: (value: LiveRoomState['voiceToken']) => void;
  setNotice: (value: LiveRoomState['notice']) => void;
};
export const createSessionSlice: StateCreator<LiveRoomStore, [], [], SessionActions> = (set) => ({
  setRole: (role) => set({ role }),
  setRoomNotice: (roomNotice) => set({ roomNotice }),
  setNickname: (nickname) => set({ nickname }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setParticipants: (participants) => set({ participants }),
  setError: (error) => set({ error }),
  setIsJoining: (isJoining) => set({ isJoining }),
  setIsDispatchingAgent: (isDispatchingAgent) => set({ isDispatchingAgent }),
  setAgentRequested: (agentRequested) => set({ agentRequested }),
  setVoiceToken: (voiceToken) => set({ voiceToken }),
  setNotice: (notice) => set({ notice }),
});
