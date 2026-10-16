'use client';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createLiveRoomStore, liveRoomSelectors } from '@/stores/live/room';
import { useEffect, useRef } from 'react';
import { ConnectionState, ParticipantKind, Room, RoomEvent, Track } from 'livekit-client';
import { subscribeRoomNotice } from '@/stores/live/room/subscriptions';
import { useLiveVoice } from './use-live-voice';

import type { Role, ParticipantItem } from '@/stores/live/room';
export type { Role } from '@/stores/live/room';

type JoinResponse = {
  token: string;
  voiceToken?: string;
  role: 'host' | 'viewer';
  notice?: string;
  livekitUrl: string;
  roomId: string;
  identity: string;
};

export type LiveRoomProps = {
  apiBaseUrl: string;
  roomId: string;
  roomTitle: string;
  isLoggedIn: boolean;
  hostNickname: string;
};

function detectRole(identity: string, kind: ParticipantKind): Role | 'AI助手' {
  if (kind === ParticipantKind.AGENT) return 'AI助手';
  if (identity.startsWith('host_')) return '主播';
  return '观众';
}

function buildParticipantList(room: Room, localIdentity: string): ParticipantItem[] {
  const items: ParticipantItem[] = [];

  items.push({
    identity: localIdentity,
    displayName: room.localParticipant.name || localIdentity,
    role: detectRole(localIdentity, ParticipantKind.STANDARD),
    isLocal: true,
  });

  for (const p of room.remoteParticipants.values()) {
    items.push({
      identity: p.identity,
      displayName: p.name || p.identity,
      role: detectRole(p.identity, p.kind),
      isLocal: false,
    });
  }

  return items;
}

function clearContainer(ref: React.RefObject<HTMLDivElement | null>) {
  if (ref.current) ref.current.innerHTML = '';
}

function normalizeError(message: string) {
  if (message.toLowerCase().includes('could not establish pc connection')) {
    return '暂时无法连接直播，请检查网络后重新加入。';
  }
  return message;
}

async function readApiError(response: Response) {
  try {
    const data = (await response.json()) as { message?: string | string[]; error?: { message?: string } };
    if (typeof data.error?.message === 'string') return data.error.message;
    if (Array.isArray(data.message)) return data.message.join('; ');
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
  } catch {
    // ignore
  }
  return `请求失败: ${response.status}`;
}

export function useLiveRoom({ apiBaseUrl, roomId, roomTitle, isLoggedIn, hostNickname }: LiveRoomProps) {
  const ui = useStoreInstance(() => createLiveRoomStore(isLoggedIn ? hostNickname : '', { dispatch: async () => {
    const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/agent/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await readApiError(response));
  } }));
  const { role, roomNotice, nickname, connectionState, participants, error, isJoining, isDispatchingAgent, agentRequested, mediaBusy, cameraEnabled, microphoneEnabled, audioBlocked, sideTab, voiceToken, notice, isFullscreen } = useStore(ui, useShallow(liveRoomSelectors.view));
  const { dispatchAgent, setRole, setRoomNotice, setNickname, setConnectionState, setParticipants, setError, setIsJoining, setCameraEnabled, setMicrophoneEnabled, setAudioBlocked, setSideTab, setVoiceToken, setNotice, setIsFullscreen } = ui.getState();
  const isHost = role === '主播';

  const stageRef = useRef<HTMLDivElement>(null);

  const joinRequestRef = useRef<AbortController | null>(null);
  const localIdentityRef = useRef('');
  const roomRef = useRef<Room | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement>(null);

  const isConnected = connectionState === ConnectionState.Connected;
  const isReconnecting = connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting;
  const isInRoom = isConnected || isReconnecting;
  const hasAgent = participants.some((p) => p.role === 'AI助手');
  const voice = useLiveVoice({ room: isInRoom ? roomRef.current : null, token: voiceToken, apiBaseUrl, roomId, isHost });

  function refreshParticipants(room: Room) {
    setParticipants(buildParticipantList(room, localIdentityRef.current));
  }

  function attachRemoteTrack(track: Track) {
    if (track.kind !== Track.Kind.Audio || !remoteAudioRef.current) return;
    const sid = track.sid ?? `${track.kind}:${track.mediaStreamTrack.id}`;
    if (remoteAudioRef.current.querySelector(`[data-track-sid="${sid}"]`)) return;
    const element = track.attach();
    element.setAttribute('data-track-sid', sid);
    remoteAudioRef.current.appendChild(element);
  }

  function detachTrack(track: Track) {
    if (track.kind !== Track.Kind.Audio) return;
    track.detach().forEach((el) => el.remove());
    // LiveKit may already have detached the track before emitting unsubscribe.
    // Remove our owned element as well so muted/replaced audio cannot accumulate.
    if (track.sid) remoteAudioRef.current?.querySelectorAll(`[data-track-sid="${track.sid}"]`).forEach((element) => element.remove());
  }

  function attachExistingRemoteTracks(room: Room) {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attachRemoteTrack(publication.track);
      }
    }
  }

  async function joinRoom() {
    if (joinRequestRef.current || roomRef.current) return;
    const controller = new AbortController();
    joinRequestRef.current = controller;
    setError(null);
    setIsJoining(true);
    let room: Room | null = null;
    try {
      const name = nickname.trim() || '观众';

      const joinResponse = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: controller.signal,
      });
      if (!joinResponse.ok) throw new Error(await readApiError(joinResponse));

      const data = (await joinResponse.json()) as JoinResponse;
      if (controller.signal.aborted) return;
      if (data.role !== 'host' && data.role !== 'viewer') {
        throw new Error('暂时无法确认房间身份，请稍后重新加入。');
      }
      localIdentityRef.current = data.identity;
      setRole(data.role === 'host' ? '主播' : '观众');
      setRoomNotice(data.notice || '');
      setVoiceToken(data.voiceToken || '');
      setNickname(name);

      const activeRoom = new Room();
      room = activeRoom;
      roomRef.current = activeRoom;
      activeRoom
        .on(RoomEvent.ConnectionStateChanged, (state) => {
          if (roomRef.current !== activeRoom) return;
          setConnectionState(state);
        })
        .on(RoomEvent.ParticipantConnected, () => refreshParticipants(activeRoom))
        .on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(activeRoom))
        .on(RoomEvent.ParticipantNameChanged, () => refreshParticipants(activeRoom))
        .on(RoomEvent.TrackSubscribed, (track) => attachRemoteTrack(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track))
        .on(RoomEvent.LocalTrackPublished, syncLocalMedia)
        .on(RoomEvent.LocalTrackUnpublished, syncLocalMedia)
        .on(RoomEvent.TrackMuted, syncLocalMedia)
        .on(RoomEvent.TrackUnmuted, syncLocalMedia)
        .on(RoomEvent.Reconnected, () => {
          refreshParticipants(activeRoom);
          syncLocalMedia();
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!activeRoom.canPlaybackAudio))
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current !== activeRoom) return;
          activeRoom.removeAllListeners();
          roomRef.current = null;
          resetSession();
          setError('房间连接已关闭，可重新加入；如果房间已关闭，请返回直播大厅。');
        });

      await activeRoom.connect(data.livekitUrl, data.token);
      if (controller.signal.aborted || roomRef.current !== activeRoom) {
        await activeRoom.disconnect();
        return;
      }
      refreshParticipants(activeRoom);
      attachExistingRemoteTracks(activeRoom);
      setAudioBlocked(!activeRoom.canPlaybackAudio);
    } catch (err) {
      if (room) {
        room.removeAllListeners();
        await room.disconnect();
      }
      if (controller.signal.aborted) return;
      roomRef.current = null;
      resetSession();
      setError(err instanceof Error ? normalizeError(err.message) : '加入房间失败');
    } finally {
      if (joinRequestRef.current === controller) {
        joinRequestRef.current = null;
        setIsJoining(false);
      }
    }
  }

  function syncLocalMedia() {
    const room = roomRef.current;
    if (!room) return;
    setCameraEnabled(room.localParticipant.isCameraEnabled);
    setMicrophoneEnabled(room.localParticipant.isMicrophoneEnabled);
  }

  async function toggleLocalMedia(device: 'camera' | 'microphone') {
    await ui.getState().toggleMedia(device, async () => {
      const room = roomRef.current;
      if (!room) return null;
      if (device === 'camera') await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
      else await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      if (roomRef.current !== room) {
        for (const publication of room.localParticipant.trackPublications.values()) publication.track?.stop();
        return null;
      }
      return { cameraEnabled: room.localParticipant.isCameraEnabled, microphoneEnabled: room.localParticipant.isMicrophoneEnabled };
    });
  }

  function resetSession() {
    ui.getState().resetSession();
    localIdentityRef.current = '';
    clearContainer(remoteAudioRef);
  }

  async function leaveRoom() {
    const room = roomRef.current;
    joinRequestRef.current?.abort();
    joinRequestRef.current = null;
    roomRef.current = null;
    room?.removeAllListeners();
    setIsJoining(false);
    setError(null);
    resetSession();
    await room?.disconnect();
  }

  async function enableAudio() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      if (roomRef.current === room) setAudioBlocked(!room.canPlaybackAudio);
    } catch {
      if (roomRef.current === room) setError('声音播放失败，请再点击一次“播放声音”。');
    }
  }

  useEffect(() => {
    // Entering this page is the join action. Defer one task so Strict Mode's
    // setup/cleanup replay cannot issue two join requests or open two rooms.
    const autoJoin = window.setTimeout(() => void joinRoom(), 0);
    return () => {
      window.clearTimeout(autoJoin);
      joinRequestRef.current?.abort();
      joinRequestRef.current = null;
      const room = roomRef.current;
      roomRef.current = null;
      room?.removeAllListeners();
      void room?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !roomRef.current || !remoteAudioRef.current) return;
    attachExistingRemoteTracks(roomRef.current);
  }, [isConnected, participants.length]);

  useEffect(() => subscribeRoomNotice(ui), [ui]);

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  async function shareRoom() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice('直播间链接已复制'); }
    catch { setNotice('复制失败，请复制浏览器地址栏中的链接。'); }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch { setNotice('当前浏览器暂不支持全屏观看。'); }
  }

  return { role, isHost, roomNotice, nickname, setNickname, participants, error, setError, isJoining, isDispatchingAgent, agentRequested, mediaBusy, cameraEnabled, microphoneEnabled, audioBlocked, sideTab, setSideTab, notice, isFullscreen, stageRef, roomRef, remoteAudioRef, isConnected, isReconnecting, isInRoom, hasAgent, voice, joinRoom, toggleLocalMedia, dispatchAgent, leaveRoom, enableAudio, shareRoom, toggleFullscreen };
}
