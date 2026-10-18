'use client';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createLiveVoiceStore, liveVoiceSelectors } from '@/stores/live/voice';

import { useEffect, useRef } from 'react';
import { ConnectionState, createLocalAudioTrack, createLocalVideoTrack, ParticipantKind, Room, RoomEvent, Track, type LocalTrack, type Participant } from 'livekit-client';

import { APIError, check } from '@/services/api/client';

const ATTRIBUTE = 'live.voice';
import type { VoiceSlot, VoiceState, Device, VoiceAction } from '@/stores/live/voice';
export type { VoiceSlot } from '@/stores/live/voice';

function participantRequest(participant: Participant): VoiceSlot | null {
  try {
    const value = JSON.parse(participant.attributes[ATTRIBUTE] || 'null');
    if (!value || typeof value.requestId !== 'string' || value.participantSid !== participant.sid || !['pending', 'approved'].includes(value.status)) return null;
    return { ...value, identity: participant.identity, name: participant.name || '观众' };
  } catch { return null; }
}


export function useLiveVoice({ room, token, apiBaseUrl, roomId, isHost }: { room: Room | null; token: string; apiBaseUrl: string; roomId: string; isHost: boolean }) {
  const ui = useStoreInstance(createLiveVoiceStore);
  const { state, ready, busy, mediaBusy, microphoneEnabled, cameraEnabled, speakerEnabled, error } = useStore(ui, useShallow(liveVoiceSelectors.view));
  const { setState, setReady, setMediaBusy, setMicrophoneEnabled, setCameraEnabled, setSpeakerEnabled, setError } = ui.getState();
  const sessionRef = useRef<Room | null>(null);
  const generationRef = useRef(0);
  const versionRef = useRef(0);
  const mediaBusyRef = useRef<Device | null>(null);
  const tracksRef = useRef<Record<Device, LocalTrack | null>>({ microphone: null, camera: null });
  const deviceGenerationRef = useRef<Record<Device, number>>({ microphone: 0, camera: 0 });
  const stoppingTracks = useRef(new Set<LocalTrack>());
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const lifetimeRef = useRef<AbortController | null>(null);
  const base = `${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/voice`;

  function allowed(current: Room, device: Device = 'microphone') {
    const slot = ui.getState().state.slot;
    const permissions = current.localParticipant.permissions;
    return sessionRef.current === current && current.state === ConnectionState.Connected && ui.getState().state.hasHost &&
      slot?.identity === current.localParticipant.identity && slot.participantSid === current.localParticipant.sid && slot.status === 'approved' &&
      !!permissions?.canPublish && permissions.canPublishSources.includes(device === 'camera' ? 1 : 2);
  }

  function stopDevice(current: Room, device: Device) {
    deviceGenerationRef.current[device]++;
    const tracks = new Set<LocalTrack>();
    const captured = tracksRef.current[device];
    if (captured) tracks.add(captured);
    tracksRef.current[device] = null;
    const source = device === 'camera' ? Track.Source.Camera : Track.Source.Microphone;
    for (const publication of current.localParticipant.trackPublications.values()) {
      if (publication.source === source && publication.track) tracks.add(publication.track);
    }
    for (const track of tracks) {
      track.stop();
      if (!stoppingTracks.current.has(track)) {
        stoppingTracks.current.add(track);
        void current.localParticipant.unpublishTrack(track, true).catch(() => {}).finally(() => stoppingTracks.current.delete(track));
      }
    }
    if (sessionRef.current === current) {
      if (device === 'camera') { setCameraEnabled(false); }
      else setMicrophoneEnabled(false);
    }
  }

  function stopDevices(current: Room) {
    stopDevice(current, 'microphone');
    stopDevice(current, 'camera');
  }

  useEffect(() => {
    sessionRef.current = room;
    ui.getState().resetSession();
    mediaBusyRef.current = null;
    generationRef.current++;
    if (!room || !token) return;
    const controller = new AbortController();
    lifetimeRef.current = controller;

    const unsubscribePermissions = ui.subscribe(s => s.state, (next, previous) => {
      if (previous.slot?.requestId !== next.slot?.requestId || (previous.slot?.status === 'approved' && next.slot?.status !== 'approved')) generationRef.current++;
      if (!isHost) {
        if (!allowed(room!, 'microphone')) stopDevice(room!, 'microphone');
        if (!allowed(room!, 'camera')) stopDevice(room!, 'camera');
      }
    });
    function apply(next: VoiceState) {
      setState(next);
      setMicrophoneEnabled(room!.localParticipant.isMicrophoneEnabled);
      setCameraEnabled(room!.localParticipant.isCameraEnabled);
      const speaker = next.slot?.identity === room!.localParticipant.identity ? room!.localParticipant : room!.remoteParticipants.get(next.slot?.identity || '');
      setSpeakerEnabled(!!speaker?.isMicrophoneEnabled);
    }

    function sync() {
      if (sessionRef.current !== room) return;
      versionRef.current++;
      const participants: Participant[] = [room!.localParticipant, ...room!.remoteParticipants.values()];
      const hasHost = participants.some((p) => p.kind !== ParticipantKind.AGENT && p.identity.startsWith('host_'));
      const slot = participants.filter((p) => p.kind !== ParticipantKind.AGENT && p.identity.startsWith('viewer_')).map(participantRequest).find(Boolean) || null;
      apply({ slot, hasHost });
    }

    let refreshPromise: Promise<void> | null = null;
    let refreshAgain = false;
    async function fetchState() {
      const version = versionRef.current;
      try {
        const response = await fetch(base, { headers: { 'X-Live-Voice-Token': token }, signal: controller.signal, cache: 'no-store' });
        await check(response);
        const next = await response.json() as VoiceState;
        if (sessionRef.current !== room || controller.signal.aborted) return;
        if (version === versionRef.current) apply(next);
        setReady(true);
      } catch (err) {
        if (!controller.signal.aborted && sessionRef.current === room) {
          if (err instanceof APIError && err.retryAfterMs) ui.getState().setRetryAfter(err.retryAfterMs);
          setReady(false);
          setError(err instanceof Error ? err.message : '连线状态更新失败，请稍后重试');
        }
      }
    }
    function refresh(): Promise<void> {
      if (Date.now() < ui.getState().retryAt || controller.signal.aborted || room!.state !== ConnectionState.Connected) return Promise.resolve();
      if (refreshPromise) { refreshAgain = true; return refreshPromise; }
      refreshPromise = (async () => {
        do {
          refreshAgain = false;
          await fetchState();
        } while (refreshAgain && !controller.signal.aborted && room!.state === ConnectionState.Connected);
      })().finally(() => { refreshPromise = null; });
      return refreshPromise;
    }
    refreshRef.current = refresh;
    const reconnect = () => { sync(); setError(''); void refresh(); };
    const connectionChanged = () => {
      if (room.state !== ConnectionState.Connected && !isHost) stopDevices(room);
      sync();
    };
    const events = [RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantPermissionsChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.ParticipantNameChanged] as const;
    events.forEach((event) => room.on(event, sync));
    room.on(RoomEvent.Reconnected, reconnect).on(RoomEvent.ConnectionStateChanged, connectionChanged);
    sync();
    void refresh();
    return () => {
      unsubscribePermissions();
      controller.abort();
      events.forEach((event) => room.off(event, sync));
      room.off(RoomEvent.Reconnected, reconnect).off(RoomEvent.ConnectionStateChanged, connectionChanged);
      if (!isHost) stopDevices(room);
      if (sessionRef.current === room) sessionRef.current = null;
      lifetimeRef.current = null;
      refreshRef.current = async () => {};
    };
  }, [room, token, base, isHost]);

  function act(action: VoiceAction) {
    const current = sessionRef.current;
    const controller = lifetimeRef.current;
    if (!current || !controller || current.state !== ConnectionState.Connected) return;
    return ui.getState().act(action, isHost, {
      isCurrent: () => sessionRef.current === current && !controller.signal.aborted,
      stopDevices: () => stopDevices(current),
      refresh: () => refreshRef.current(),
      request: async (requestedAction, requestId) => {
        const suffix = requestedAction === 'request' || requestedAction === 'cancel' ? '/request' : requestedAction === 'end' ? '/end' : `/requests/${encodeURIComponent(requestId)}/${requestedAction}`;
        const response = await fetch(`${base}${suffix}`, {
          method: requestedAction === 'cancel' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Live-Voice-Token': token },
          body: JSON.stringify({ requestId }), signal: controller.signal,
        });
        await check(response);
      },
    });
  }

  async function toggleDevice(device: Device) {
    const current = sessionRef.current;
    if (!current || isHost) return;
    const enabled = device === 'camera' ? current.localParticipant.isCameraEnabled : current.localParticipant.isMicrophoneEnabled;
    if (enabled) { stopDevice(current, device); return; }
    if (mediaBusyRef.current || !allowed(current, device)) return;
    mediaBusyRef.current = device;
    setMediaBusy(device);
    setError('');
    const generation = generationRef.current;
    const deviceGeneration = deviceGenerationRef.current[device];
    const stillAllowed = () => generation === generationRef.current && deviceGeneration === deviceGenerationRef.current[device] && allowed(current, device);
    let track: LocalTrack | undefined;
    try {
      // Capture first, then recheck approval before publishing. A delayed browser
      // permission prompt must never reopen a call that the host already ended.
      track = device === 'camera'
        ? await createLocalVideoTrack({ facingMode: 'user', resolution: { width: 640, height: 360 } })
        : await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (!stillAllowed()) { track.stop(); return; }
      tracksRef.current[device] = track;
      await current.localParticipant.publishTrack(track, { source: device === 'camera' ? Track.Source.Camera : Track.Source.Microphone });
      if (!stillAllowed()) {
        track.stop();
        await current.localParticipant.unpublishTrack(track, true);
        return;
      }
      if (device === 'camera') { setCameraEnabled(true); }
      else setMicrophoneEnabled(true);
    } catch (err) {
      track?.stop();
      if (tracksRef.current[device] === track) tracksRef.current[device] = null;
      const name = device === 'camera' ? '摄像头' : '麦克风';
      if (sessionRef.current === current && generation === generationRef.current) setError(err instanceof Error && err.name === 'NotAllowedError'
        ? `未获得${name}权限，请在浏览器网站设置中允许访问后重试。`
        : err instanceof Error && err.name === 'NotFoundError' ? `未找到${name}，请连接设备后重试。` : `${name}开启失败，请重试或结束连麦。`);
    } finally {
      if (sessionRef.current === current) { mediaBusyRef.current = null; setMediaBusy(null); }
    }
  }

  const own = !!room && state.slot?.identity === room.localParticipant.identity;
  return { ...state, own, ready, busy, mediaBusy, microphoneEnabled, cameraEnabled, speakerEnabled, error, act, refresh: () => { setError(''); return refreshRef.current(); },
    toggleMicrophone: () => toggleDevice('microphone'), toggleCamera: () => toggleDevice('camera'),
    canOpenMicrophone: !!room && allowed(room), canOpenCamera: !!room && allowed(room, 'camera'), dismissError: () => setError('') };
}

export type LiveVoice = ReturnType<typeof useLiveVoice>;
