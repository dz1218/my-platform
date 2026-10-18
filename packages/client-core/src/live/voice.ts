import { createDomainStore } from '../create-store';
export type VoiceSlot = { requestId: string; participantSid: string; status: 'pending' | 'approved'; requestedAt: number; identity: string; name: string };
export type VoiceState = { slot: VoiceSlot | null; hasHost: boolean };
export type VoiceAction = 'request' | 'cancel' | 'approve' | 'reject' | 'end';
export type VoiceTransport = {
  isCurrent: () => boolean;
  request: (action: VoiceAction, requestId: string) => Promise<void>;
  refresh: () => Promise<void>;
  stopDevices: () => void;
};
export type Device = 'microphone' | 'camera';
export type LiveVoiceState = {
  state: VoiceState;
  sessionVersion: number;
  ready: boolean;
  retryAt: number;
  busy: boolean;
  mediaBusy: Device | null;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  speakerEnabled: boolean;
  error: string;
};
export type LiveVoiceStore = LiveVoiceState & {
  setState: (value: LiveVoiceState['state']) => void;
  setReady: (value: LiveVoiceState['ready']) => void;
  setBusy: (value: LiveVoiceState['busy']) => void;
  setMediaBusy: (value: LiveVoiceState['mediaBusy']) => void;
  setMicrophoneEnabled: (value: LiveVoiceState['microphoneEnabled']) => void;
  setCameraEnabled: (value: LiveVoiceState['cameraEnabled']) => void;
  setSpeakerEnabled: (value: LiveVoiceState['speakerEnabled']) => void;
  setRetryAfter: (delay: number) => void;
  setError: (value: LiveVoiceState['error']) => void;
  resetSession: () => void;
  act: (action: VoiceAction, isHost: boolean, transport: VoiceTransport) => Promise<void>;
};
const initialState = (): LiveVoiceState => ({
  state: { slot: null, hasHost: false },
  sessionVersion: 0,
  ready: false,
  retryAt: 0,
  busy: false,
  mediaBusy: null,
  microphoneEnabled: false,
  cameraEnabled: false,
  speakerEnabled: false,
  error: '',
});
export const liveVoiceSelectors = {
  view: (s: LiveVoiceStore) => ({
    state: s.state,
    ready: s.ready,
    busy: s.busy,
    mediaBusy: s.mediaBusy,
    microphoneEnabled: s.microphoneEnabled,
    cameraEnabled: s.cameraEnabled,
    speakerEnabled: s.speakerEnabled,
    error: s.error,
  }),
};
export function createLiveVoiceStore({ createRequestId }: { createRequestId: () => string }) {
  return createDomainStore<LiveVoiceStore>()((set, get) => ({
    ...initialState(),
    setState: (state) => set({ state }),
    setReady: (ready) => set({ ready }),
    setBusy: (busy) => set({ busy }),
    setMediaBusy: (mediaBusy) => set({ mediaBusy }),
    setMicrophoneEnabled: (microphoneEnabled) => set({ microphoneEnabled }),
    setCameraEnabled: (cameraEnabled) => set({ cameraEnabled }),
    setSpeakerEnabled: (speakerEnabled) => set({ speakerEnabled }),
    setRetryAfter: delay => set({ retryAt: Date.now() + delay }),
    setError: (error) => set({ error }),
    resetSession: () => set(s => ({ ...initialState(), sessionVersion: s.sessionVersion + 1 })),
    act: async (action, isHost, transport) => {
      const { busy, sessionVersion, state } = get();
      if (busy || Date.now() < get().retryAt || !transport.isCurrent()) return;
      if ((action === 'approve' || action === 'reject') && !isHost) return;
      if ((action === 'request' || action === 'cancel') && isHost) return;
      const requestId = action === 'request' ? createRequestId() : state.slot?.requestId;
      if (!requestId) return;
      if (action === 'end' && !isHost) transport.stopDevices();
      const isCurrent = () => get().sessionVersion === sessionVersion && transport.isCurrent();
      set({ busy: true, error: '' });
      try { await transport.request(action, requestId); }
      catch (error) {
        const delay = (error as { retryAfterMs?: number })?.retryAfterMs;
        if (isCurrent() && delay) set({ retryAt: Date.now() + delay });
        if (isCurrent()) set({ error: error instanceof Error ? error.message : '连线操作失败，请重试' });
      } finally {
        if (isCurrent()) {
          try { await transport.refresh(); }
          finally { if (isCurrent()) set({ busy: false }); }
        }
      }
    },
  }));
}
