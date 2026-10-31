'use client';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createLiveRoomStore, liveRoomSelectors } from '@/stores/live/room';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveRoomDetail, LiveActivity } from '@my-platform/shared';
import { ConnectionState, DisconnectReason, ParticipantKind, Room, RoomEvent, Track } from 'livekit-client';
import { APIError, check } from '@/services/api/client';
import { liveRoomService } from '@/services/live';
import { RoomsConnection } from '@/services/rooms-connection';
import { sessionQueryOptions } from '@/services/query-options';
import { createLiveRoomUpdates } from '@my-platform/client-core';
import { subscribeRoomNotice } from '@/stores/live/room/subscriptions';
import { useLiveVoice } from './use-live-voice';
import { useLiveGovernance } from './use-live-governance';

import type { Role, ParticipantItem } from '@/stores/live/room';
export type { Role } from '@/stores/live/room';

export type LiveRoomProps = {
  apiBaseUrl: string;
  roomId: string;
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

export function useLiveRoom({ apiBaseUrl, roomId, isLoggedIn, hostNickname }: LiveRoomProps) {
  const router = useRouter();
  useEffect(() => { router.prefetch('/'); }, [router]);
  const disposedRef = useRef(false);
  const joinRequestRef = useRef<AbortController | null>(null);
  const refreshRequestRef = useRef<AbortController | null>(null);
  const localIdentityRef = useRef('');
  const roomRef = useRef<Room | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const remoteAudioRef = useRef<HTMLDivElement>(null);
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const governance = useLiveGovernance(apiBaseUrl,roomId);
  const service = useStoreInstance(() => liveRoomService(apiBaseUrl));
  const detailKey = ['live-room', apiBaseUrl, roomId];
  const roomQuery = useQuery<LiveRoomDetail | null>({
    ...sessionQueryOptions,
    queryKey: detailKey,
    queryFn: ({ signal }) => service.detail(roomId, signal),
    refetchOnMount: 'always',
    retry: false,
  });
  const ui = useStoreInstance(() => createLiveRoomStore(isLoggedIn ? hostNickname : '', {
    dispatch: () => service.dispatchAssistant(roomId),
    removeAssistant: id => service.removeAssistant(roomId, id),
    session: {
      createAttemptId: () => crypto.randomUUID(),
      canRetryBusy: () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload',
      join: (name, attemptId) => service.join(roomId, name, attemptId, joinRequestRef.current?.signal),
    },
    close: () => service.close(roomId, localIdentityRef.current || undefined),
    detail: () => service.detail(roomId, AbortSignal.timeout(10_000)),
    refresh: async () => {
      const controller = new AbortController();
      refreshRequestRef.current = controller;
      try { return await service.refreshDetail(roomId, controller.signal); }
      finally { if (refreshRequestRef.current === controller) refreshRequestRef.current = null; }
    },
    query: { client: queryClient, apiBaseUrl, roomId },
  }));
  const { role, nickname, connectionState, participants, error, isJoining, connectionPending, joinFailure, recovering, returnToLobby, closeConfirmOpen, isClosing, closeError, isRefreshing, refreshError, updatesState, isDispatchingAgent, mediaBusy, cameraEnabled, microphoneEnabled, audioBlocked, sideTab, voiceToken, notice, isFullscreen } = useStore(ui, useShallow(liveRoomSelectors.view));
  const { dispatchAgent, removeAgent, setNickname, setConnectionState, setParticipants, setError, setIsJoining, setCameraEnabled, setMicrophoneEnabled, setAudioBlocked, setSideTab, setNotice, setIsFullscreen, setCloseConfirmOpen, refreshRoom } = ui.getState();
  const isHost = role === '主播';
  const roomMissing = roomQuery.data === null || (roomQuery.error instanceof APIError && roomQuery.error.status === 404);
  const roomEnded = joinFailure === 'closed' || joinFailure === 'missing' || roomMissing || (!!roomQuery.data && roomQuery.data.state !== 'open');
  // A reload may briefly wait for the previous host session to be released.
  const roomInUse = joinFailure === 'in-use' && !connectionPending;
  const hostRecovering = roomQuery.data?.hostConnection === 'reconnecting';
  const roomTitle = roomQuery.data?.item.title ?? '直播间';
  const updatesLabel = updatesState === 'connected' ? '房间状态实时更新' : updatesState === 'reconnecting' ? '状态更新重新连接中…' : '正在连接状态更新…';

  useEffect(() => {
    const updates = createLiveRoomUpdates(queryClient, apiBaseUrl, roomId);
    const connection = new RoomsConnection({ roomId, roomToken: governance.state.token || undefined,
      after: () => queryClient.getQueryData<LiveActivity>(governance.queryKey)?.sequence ?? 0,
      onActivity: event => { if (governance.store.getState().token === governance.state.token) governance.store.getState().receive(event); },
      onUpdate: event => { void updates.receive(event); },
      onState: ui.getState().setUpdatesState,
    });
    return () => { updates.close(); connection.close(); refreshRequestRef.current?.abort(); };
  }, [queryClient, apiBaseUrl, roomId, ui, governance.state.token]);

  const isConnected = connectionState === ConnectionState.Connected;
  const isReconnecting = connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting;
  const isInRoom = isConnected || isReconnecting;
  const assistant = roomQuery.data?.assistant ?? { status: 'idle' as const };
  const hasAgent = assistant.status === 'online' && participants.some(p => p.role === 'AI助手' && p.identity === assistant.identity);
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
    const detail = queryClient.getQueryData<LiveRoomDetail | null>(detailKey);
    if (disposedRef.current || joinRequestRef.current || roomRef.current || detail === null || (detail && detail.state !== 'open') || ui.getState().isClosing) return;
    const controller = new AbortController();
    joinRequestRef.current = controller;
    const attempt = { room: null as Room | null };
    const joined = await ui.getState().joinSession(async data => {
      governance.store.getState().bind(data);
      localIdentityRef.current = data.identity;
      const activeRoom = new Room();
      attempt.room = activeRoom;
      roomRef.current = activeRoom;
      let hasConnected = false;
      const confirmPresence = async () => {
        if (data.role !== 'host' || !data.voiceToken || roomRef.current !== activeRoom) return;
        try {
          await service.confirmPresence(roomId, data.voiceToken, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || roomRef.current !== activeRoom) return;
          // A successful SDK connection can precede LiveKit's participant list.
          // The server's reconciliation also confirms presence; only a terminal
          // response ends this session, never a transient verification failure.
          if (error instanceof APIError && (error.code === 'room_closed' || error.status === 410)) {
            queryClient.setQueryData<LiveRoomDetail>(detailKey, current => current ? { ...current, state: 'closed' } : current);
            void refreshRoom();
            throw error;
          }
        }
      };
      activeRoom
        .on(RoomEvent.ConnectionStateChanged, (state) => {
          if (roomRef.current !== activeRoom) return;
          if (state === ConnectionState.Connected) hasConnected = true;
          setConnectionState(state);
        })
        .on(RoomEvent.ParticipantConnected, () => refreshParticipants(activeRoom))
        .on(RoomEvent.ParticipantDisconnected, participant => {
          if (roomRef.current !== activeRoom) return;
          refreshParticipants(activeRoom);
          if (participant.identity.startsWith('host_')) void refreshRoom();
        })
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
          void confirmPresence().catch(() => void leaveRoom());
          void refreshRoom();
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!activeRoom.canPlaybackAudio))
        .on(RoomEvent.Disconnected, (reason) => {
          if (roomRef.current !== activeRoom) return;
          activeRoom.removeAllListeners();
          roomRef.current = null;
          resetSession();
          if (reason===DisconnectReason.PARTICIPANT_REMOVED) { governance.store.getState().markRemoved(); ui.getState().handleRoomRemoved(); }
          else if (hasConnected) ui.getState().handleHostDisconnected();
          else setError('连接已断开，请重新加入或返回直播大厅。');
          void refreshRoom();
          void queryClient.invalidateQueries({ queryKey: ['live-rooms', apiBaseUrl] });
        });

      await activeRoom.connect(data.livekitUrl, data.token);
      if (controller.signal.aborted || roomRef.current !== activeRoom) {
        await activeRoom.disconnect();
        return;
      }
      await confirmPresence();
      if (controller.signal.aborted || roomRef.current !== activeRoom) return;
      refreshParticipants(activeRoom);
      attachExistingRemoteTracks(activeRoom);
      setAudioBlocked(!activeRoom.canPlaybackAudio);
      void governance.store.getState().refresh().catch(()=>{});
    }, () => controller.signal.aborted);
    if (!joined && !controller.signal.aborted) {
      const room = attempt.room;
      room?.removeAllListeners();
      if (roomRef.current === room) roomRef.current = null;
      await room?.disconnect();
      resetSession();
    }
    if (joinRequestRef.current === controller) {
      joinRequestRef.current = null;
      setIsJoining(false);
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
    ui.getState().cancelJoinRecovery();
    governance.store.getState().clear();
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

  async function endRoom() {
    const returnAfterClose = ui.getState().returnToLobby;
    if (await ui.getState().endRoom()) {
      if (returnAfterClose && !disposedRef.current) router.push('/');
      else await leaveRoom();
    }
  }

  function returnToHall() {
    // The route cleanup disconnects LiveKit. Resetting the visible session here
    // would flash the disconnected screen while navigation is still pending.
    if (ui.getState().requestLobbyReturn()) router.push('/');
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
    disposedRef.current = false;
    // Entering this page is the join action. Defer one task so Strict Mode's
    // setup/cleanup replay cannot issue two join requests or open two rooms.
    const autoJoin = window.setTimeout(() => void joinRoom(), 0);
    return () => {
      disposedRef.current = true;
      governance.store.getState().clear();
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = ui.subscribe(s => s.joinRetryAt, at => {
      clearTimeout(timer);
      if (at > 0) timer = setTimeout(() => void joinRoom(), Math.max(0, at - Date.now()));
    }, { fireImmediately: true });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [ui]);

  useEffect(() => {
    if (!isConnected || !roomRef.current || !remoteAudioRef.current) return;
    attachExistingRemoteTracks(roomRef.current);
  }, [isConnected, participants.length]);

  useEffect(() => subscribeRoomNotice(ui), [ui]);

  useEffect(() => governance.store.subscribe(s=>s.removed, removed=>{
    if (!removed) return;
    ui.getState().cancelJoinRecovery();
    ui.getState().handleRoomRemoved();
    const room=roomRef.current; roomRef.current=null; room?.removeAllListeners(); void room?.disconnect();
    setConnectionState(ConnectionState.Disconnected); clearContainer(remoteAudioRef);
  }), [governance.store,ui]);

  useEffect(() => ui.subscribe(state => state.closeConfirmOpen, open => {
    if (open) closeDialogRef.current?.showModal();
    else closeDialogRef.current?.close();
  }, { fireImmediately: true }), [ui]);

  useEffect(() => {
    if (!roomEnded) return;
    void leaveRoom();
    void queryClient.invalidateQueries({ queryKey: ['live-rooms', apiBaseUrl] });
  }, [roomEnded]);

  useEffect(() => {
    if (roomEnded && !isClosing) setCloseConfirmOpen(false);
  }, [roomEnded, isClosing]);

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

  return { governance, roomBanned: joinFailure === 'banned' || governance.state.removed, roomTitle, roomTitlePending: roomQuery.isPending, roomEnded, roomInUse, hostRecovering, recovering, returnToLobby, returnToHall, roomReason: roomQuery.data?.reason, closeConfirmOpen, setCloseConfirmOpen, isClosing, closeError, closeDialogRef, endRoom, refreshRoom, isRefreshing, refreshError, updatesLabel, role, isHost, nickname, setNickname, participants, error, setError, isJoining, connectionPending, isDispatchingAgent, mediaBusy, cameraEnabled, microphoneEnabled, audioBlocked, sideTab, setSideTab, notice, isFullscreen, stageRef, roomRef, remoteAudioRef, isConnected, isReconnecting, isInRoom, hasAgent, assistant, voice, joinRoom, toggleLocalMedia, dispatchAgent, removeAgent, leaveRoom, enableAudio, shareRoom, toggleFullscreen };
}
