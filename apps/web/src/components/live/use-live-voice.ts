'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectionState, createLocalAudioTrack, createLocalVideoTrack, ParticipantKind, Room, RoomEvent, Track, type LocalTrack, type Participant } from 'livekit-client';

const ATTRIBUTE = 'live.voice';
export type VoiceSlot = { requestId: string; participantSid: string; status: 'pending' | 'approved'; requestedAt: number; identity: string; name: string };
type VoiceState = { slot: VoiceSlot | null; hasHost: boolean };
type Action = 'request' | 'cancel' | 'approve' | 'reject' | 'end';
type Device = 'microphone' | 'camera';

function participantRequest(participant: Participant): VoiceSlot | null {
  try {
    const value = JSON.parse(participant.attributes[ATTRIBUTE] || 'null');
    if (!value || typeof value.requestId !== 'string' || value.participantSid !== participant.sid || !['pending', 'approved'].includes(value.status)) return null;
    return { ...value, identity: participant.identity, name: participant.name || '观众' };
  } catch { return null; }
}

async function apiError(response: Response) {
  try { return (await response.json()).error?.message || '连线操作失败，请重试'; }
  catch { return '连线操作失败，请重试'; }
}

export function useLiveVoice({ room, token, apiBaseUrl, roomId, isHost }: { room: Room | null; token: string; apiBaseUrl: string; roomId: string; isHost: boolean }) {
  const [state, setState] = useState<VoiceState>({ slot: null, hasHost: false });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<Device | null>(null);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraTrack, setCameraTrack] = useState<LocalTrack | null>(null);
  const [speakerEnabled, setSpeakerEnabled] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef<Room | null>(null);
  const stateRef = useRef(state);
  const generationRef = useRef(0);
  const versionRef = useRef(0);
  const busyRef = useRef(false);
  const mediaBusyRef = useRef<Device | null>(null);
  const tracksRef = useRef<Record<Device, LocalTrack | null>>({ microphone: null, camera: null });
  const deviceGenerationRef = useRef<Record<Device, number>>({ microphone: 0, camera: 0 });
  const stoppingTracks = useRef(new Set<LocalTrack>());
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const lifetimeRef = useRef<AbortController | null>(null);
  const base = `${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/voice`;

  function allowed(current: Room, device: Device = 'microphone') {
    const slot = stateRef.current.slot;
    const permissions = current.localParticipant.permissions;
    return sessionRef.current === current && current.state === ConnectionState.Connected && stateRef.current.hasHost &&
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
      if (device === 'camera') { setCameraEnabled(false); setCameraTrack(null); }
      else setMicrophoneEnabled(false);
    }
  }

  function stopDevices(current: Room) {
    stopDevice(current, 'microphone');
    stopDevice(current, 'camera');
  }

  useEffect(() => {
    sessionRef.current = room;
    stateRef.current = { slot: null, hasHost: false };
    setState(stateRef.current);
    setReady(false);
    setError('');
    setBusy(false);
    setMediaBusy(null);
    setMicrophoneEnabled(false);
    setCameraEnabled(false);
    setCameraTrack(null);
    setSpeakerEnabled(false);
    busyRef.current = false;
    mediaBusyRef.current = null;
    generationRef.current++;
    if (!room || !token) return;
    const controller = new AbortController();
    lifetimeRef.current = controller;

    function apply(next: VoiceState) {
      const previous = stateRef.current.slot;
      stateRef.current = next;
      setState(next);
      if (previous?.requestId !== next.slot?.requestId || (previous?.status === 'approved' && next.slot?.status !== 'approved')) generationRef.current++;
      if (!isHost) {
        if (!allowed(room!, 'microphone')) stopDevice(room!, 'microphone');
        if (!allowed(room!, 'camera')) stopDevice(room!, 'camera');
      }
      setMicrophoneEnabled(room!.localParticipant.isMicrophoneEnabled);
      setCameraEnabled(room!.localParticipant.isCameraEnabled);
      setCameraTrack(room!.localParticipant.getTrackPublication(Track.Source.Camera)?.track || null);
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

    let refreshing = false;
    async function refresh() {
      if (refreshing || controller.signal.aborted || room!.state !== ConnectionState.Connected) return;
      refreshing = true;
      const version = versionRef.current;
      try {
        const response = await fetch(base, { headers: { 'X-Live-Voice-Token': token }, signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(await apiError(response));
        const next = await response.json() as VoiceState;
        if (sessionRef.current !== room || controller.signal.aborted) return;
        if (version === versionRef.current) apply(next);
        setReady(true);
      } catch (err) {
        if (!controller.signal.aborted && sessionRef.current === room) {
          setReady(false);
          setError(err instanceof Error ? err.message : '连线状态更新失败，请稍后重试');
        }
      } finally { refreshing = false; }
    }
    refreshRef.current = refresh;
    const reconnect = () => { sync(); void refresh(); };
    const connectionChanged = () => {
      if (room.state !== ConnectionState.Connected && !isHost) stopDevices(room);
      sync();
    };
    const events = [RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantPermissionsChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.ParticipantNameChanged] as const;
    events.forEach((event) => room.on(event, sync));
    room.on(RoomEvent.Reconnected, reconnect).on(RoomEvent.ConnectionStateChanged, connectionChanged);
    sync();
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      events.forEach((event) => room.off(event, sync));
      room.off(RoomEvent.Reconnected, reconnect).off(RoomEvent.ConnectionStateChanged, connectionChanged);
      if (!isHost) stopDevices(room);
      if (sessionRef.current === room) sessionRef.current = null;
      lifetimeRef.current = null;
      refreshRef.current = async () => {};
    };
  }, [room, token, base, isHost]);

  async function act(action: Action) {
    const current = sessionRef.current;
    if (!current || current.state !== ConnectionState.Connected || busyRef.current) return;
    const slot = stateRef.current.slot;
    const requestId = action === 'request' ? crypto.randomUUID() : slot?.requestId;
    if (!requestId) return;
    if (action === 'end' && !isHost) stopDevices(current);
    const controller = lifetimeRef.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const suffix = action === 'request' || action === 'cancel' ? '/request' : action === 'end' ? '/end' : `/requests/${encodeURIComponent(requestId)}/${action}`;
      const response = await fetch(`${base}${suffix}`, {
        method: action === 'cancel' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Live-Voice-Token': token },
        body: JSON.stringify({ requestId }), signal: controller?.signal,
      });
      if (!response.ok) throw new Error(await apiError(response));
    } catch (err) {
      if (sessionRef.current === current && !controller?.signal.aborted) setError(err instanceof Error ? err.message : '连线操作失败，请重试');
    } finally {
      if (sessionRef.current === current && !controller?.signal.aborted) {
        await refreshRef.current();
        busyRef.current = false;
        setBusy(false);
      }
    }
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
      if (device === 'camera') { setCameraEnabled(true); setCameraTrack(track); }
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
  return { ...state, own, ready, busy, mediaBusy, microphoneEnabled, cameraEnabled, cameraTrack, speakerEnabled, error, act,
    toggleMicrophone: () => toggleDevice('microphone'), toggleCamera: () => toggleDevice('camera'),
    canOpenMicrophone: !!room && allowed(room), canOpenCamera: !!room && allowed(room, 'camera'), dismissError: () => setError('') };
}

export type LiveVoice = ReturnType<typeof useLiveVoice>;
