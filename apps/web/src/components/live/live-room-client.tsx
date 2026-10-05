'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LiveIcon } from './live-icon';
import { LiveChat } from './live-chat';
import { ConnectionState, ParticipantKind, Room, RoomEvent, Track } from 'livekit-client';

type Role = '主播' | '观众';

type ParticipantItem = {
  identity: string;
  displayName: string;
  role: Role | 'AI助手';
  isLocal: boolean;
};

type JoinResponse = {
  token: string;
  livekitUrl: string;
  roomId: string;
  identity: string;
};

type Props = {
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

function RoleBadge({ role }: { role: Role | 'AI助手' }) {
  return <span className={`live-role ${role === '主播' ? 'is-host' : ''}`}>{role}</span>;
}

function styleVideoElement(element: HTMLMediaElement) {
  element.classList.add('live-media-track');
  element.setAttribute('playsinline', 'true');
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

export function LiveRoomClient({ apiBaseUrl, roomId, roomTitle, isLoggedIn, hostNickname }: Props) {
  const role: Role = isLoggedIn ? '主播' : '观众';

  const [nickname, setNickname] = useState(() =>
    isLoggedIn ? hostNickname : ''
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(true);
  const [isDispatchingAgent, setIsDispatchingAgent] = useState(false);
  const [agentRequested, setAgentRequested] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<'camera' | 'microphone' | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [remoteVideoCount, setRemoteVideoCount] = useState(0);
  const [sideTab, setSideTab] = useState<'chat' | 'people'>('chat');
  const [notice, setNotice] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const joinRequestRef = useRef<AbortController | null>(null);
  const mediaBusyRef = useRef(false);
  const dispatchBusyRef = useRef(false);
  const localIdentityRef = useRef('');
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteMediaRef = useRef<HTMLDivElement>(null);

  const isConnected = connectionState === ConnectionState.Connected;
  const isReconnecting = connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting;
  const isInRoom = isConnected || isReconnecting;
  const hasAgent = participants.some((p) => p.role === 'AI助手');

  function refreshParticipants(room: Room) {
    setParticipants(buildParticipantList(room, localIdentityRef.current));
  }

  function attachRemoteTrack(track: Track) {
    if (!remoteMediaRef.current) return;
    const sid = track.sid ?? `${track.kind}:${track.mediaStreamTrack.id}`;
    if (remoteMediaRef.current.querySelector(`[data-track-sid="${sid}"]`)) return;
    const element = track.attach();
    element.setAttribute('data-track-sid', sid);
    if (track.kind === Track.Kind.Video) styleVideoElement(element);
    element.hidden = track.kind === Track.Kind.Video && track.isMuted;
    remoteMediaRef.current.appendChild(element);
    updateRemoteVideoCount();
  }

  function detachTrack(track: Track) {
    track.detach().forEach((el) => el.remove());
    updateRemoteVideoCount();
  }

  function updateRemoteVideoCount() {
    setRemoteVideoCount(remoteMediaRef.current?.querySelectorAll('video:not([hidden])').length ?? 0);
  }

  function syncRemoteMedia() {
    const room = roomRef.current;
    if (!room || !remoteMediaRef.current) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        const element = remoteMediaRef.current.querySelector<HTMLVideoElement>(`[data-track-sid="${publication.trackSid}"]`);
        if (element) element.hidden = publication.isMuted;
      }
    }
    updateRemoteVideoCount();
  }

  function attachExistingRemoteTracks(room: Room) {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attachRemoteTrack(publication.track);
      }
    }
  }

  function attachLocalVideoPreview() {
    const room = roomRef.current;
    if (!room || !localVideoRef.current) return;
    const pub = Array.from(room.localParticipant.videoTrackPublications.values()).find(
      (p) => p.track?.kind === Track.Kind.Video
    );
    if (!pub?.track || pub.isMuted) {
      clearContainer(localVideoRef);
      return;
    }
    if (localVideoRef.current.firstChild) return;
    clearContainer(localVideoRef);
    const element = pub.track.attach();
    element.muted = true;
    styleVideoElement(element);
    localVideoRef.current.appendChild(element);
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
      localIdentityRef.current = data.identity;
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
        .on(RoomEvent.TrackMuted, () => { syncLocalMedia(); syncRemoteMedia(); })
        .on(RoomEvent.TrackUnmuted, () => { syncLocalMedia(); syncRemoteMedia(); })
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
    attachLocalVideoPreview();
  }

  async function toggleLocalMedia(device: 'camera' | 'microphone') {
    const room = roomRef.current;
    if (!room || !isConnected || mediaBusyRef.current) return;
    mediaBusyRef.current = true;
    setMediaBusy(device);
    setError(null);
    try {
      if (device === 'camera') {
        await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
      } else {
        await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      }
      if (roomRef.current !== room) {
        for (const publication of room.localParticipant.trackPublications.values()) publication.track?.stop();
        return;
      }
      syncLocalMedia();
    } catch (err) {
      if (roomRef.current === room) {
        const deviceName = device === 'camera' ? '摄像头' : '麦克风';
        setError(err instanceof Error && err.name === 'NotAllowedError'
          ? `未获得${deviceName}权限，请在浏览器地址栏的网站设置中允许访问后重试。`
          : err instanceof Error && err.name === 'NotFoundError' ? `未找到${deviceName}，请连接设备后重试。` : `${deviceName}开启失败，请检查设备是否被其他应用占用。`);
      }
    } finally {
      mediaBusyRef.current = false;
      if (roomRef.current === room) setMediaBusy(null);
    }
  }

  async function dispatchAgent() {
    const room = roomRef.current;
    if (!room || !isConnected || !isLoggedIn || dispatchBusyRef.current || agentRequested || hasAgent) return;
    dispatchBusyRef.current = true;
    setError(null);
    setIsDispatchingAgent(true);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/agent/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error(await readApiError(response));
      if (roomRef.current === room) setAgentRequested(true);
    } catch (err) {
      if (roomRef.current === room) setError(err instanceof Error ? err.message : '派发 AI 助手失败');
    } finally {
      dispatchBusyRef.current = false;
      if (roomRef.current === room) setIsDispatchingAgent(false);
    }
  }

  function resetSession() {
    localIdentityRef.current = '';
    setParticipants([]);
    setConnectionState(ConnectionState.Disconnected);
    setCameraEnabled(false);
    setMicrophoneEnabled(false);
    setRemoteVideoCount(0);
    setAudioBlocked(false);
    setMediaBusy(null);
    setIsDispatchingAgent(false);
    setAgentRequested(false);
    clearContainer(localVideoRef);
    clearContainer(remoteMediaRef);
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
    if (!isConnected || !roomRef.current || !remoteMediaRef.current) return;
    attachExistingRemoteTracks(roomRef.current);
    attachLocalVideoPreview();
  }, [isConnected, participants.length]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  return <>
    <div className="live-room-nav"><Link href="/live"><LiveIcon name="back" size={17} />直播大厅</Link><span>{isLoggedIn ? '主播工作台' : '直播现场'}</span></div>
    <header className="live-room-heading">
      <div className="live-room-title"><h1 title={roomTitle}>{roomTitle}</h1><div className="live-room-meta"><RoleBadge role={role} /><span className={`live-connection ${isConnected ? 'is-connected' : ''}`} role="status"><i />{isReconnecting ? '正在重连…' : isConnected ? '已连接' : isJoining ? '连接中' : '未连接'}</span>{isInRoom && <span><LiveIcon name="users" size={14} />{participants.length} 人在房间</span>}</div></div>
      <button type="button" className="live-button live-button-secondary" onClick={() => void shareRoom()}><LiveIcon name="link" size={16} />分享直播间</button>
    </header>
    {notice && <div role="status" className="live-toast"><LiveIcon name="info" size={16} />{notice}</div>}

    <div className="live-studio">
      <div className="live-stage-column">
        <div className="live-stage" ref={stageRef}>
          <div className="live-stage-top"><span><LiveIcon name="video" size={15} />{isLoggedIn ? '本地预览' : '直播画面'}</span><span>{isInRoom ? (cameraEnabled || remoteVideoCount ? '实时画面' : '等待画面') : '尚未连接'}</span></div>
          <div className={`live-stage-media ${cameraEnabled && remoteVideoCount ? 'has-multiple' : ''}`}>
            {role === '主播' && <div ref={localVideoRef} className={`live-local-tracks ${!cameraEnabled ? 'is-hidden' : ''}`} />}
            <div ref={remoteMediaRef} className={`live-remote-tracks ${!remoteVideoCount ? 'is-hidden' : ''}`} />
          </div>
          {!isInRoom ? <div className="live-stage-empty">
            <div className="live-stage-symbol"><LiveIcon name={isJoining ? 'refresh' : error ? 'screen' : 'leave'} size={34} className={isJoining ? 'live-spin' : undefined} /></div>
            <h2>{isJoining ? '正在连接直播间' : error ? '暂时无法进入直播间' : '你已离开直播间'}</h2>
            {error ? <p role="alert">{error}</p> : <p>{isJoining ? '马上就好，请稍等片刻。' : '摄像头和麦克风已关闭，随时可以重新加入。'}</p>}
            {!isLoggedIn && !isJoining && <label className="live-guest-name"><span>观众昵称</span><input className="live-input" autoComplete="nickname" maxLength={80} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="输入你的昵称" /></label>}
            <div className="live-stage-actions"><button type="button" className="live-button live-button-light" disabled={isJoining} onClick={() => void joinRoom()}><LiveIcon name="refresh" size={16} />{isJoining ? '正在进入直播间…' : '重新加入'}</button>{isJoining && <button type="button" className="live-button live-button-stage" onClick={() => void leaveRoom()}>取消连接</button>}</div>
          </div> : !cameraEnabled && remoteVideoCount === 0 && <div className="live-stage-empty">
            <div className="live-stage-symbol"><LiveIcon name={isLoggedIn ? 'videoOff' : 'screen'} size={36} /></div><h2>{isLoggedIn ? '摄像头尚未开启' : '等主播开启画面'}</h2><p>{isLoggedIn ? '准备好后，开启摄像头与大家见面。' : '先聊聊天，画面准备好后会自动显示。'}</p>
            {isLoggedIn && <button type="button" className="live-button live-button-stage" disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('camera')}><LiveIcon name="video" size={16} />打开画面</button>}
          </div>}
          <div className="live-stage-bottom"><span>{isInRoom ? isLoggedIn ? nickname : '正在观看' : isLoggedIn ? `主播：${hostNickname}` : '观众模式'}{isInRoom && isLoggedIn && <LiveIcon name={microphoneEnabled ? 'mic' : 'micOff'} size={14} />}</span><button type="button" className="live-icon-button" title={isFullscreen ? '退出全屏' : '全屏观看'} aria-label={isFullscreen ? '退出全屏' : '全屏观看'} onClick={() => void toggleFullscreen()}><LiveIcon name="expand" size={18} /></button></div>
        </div>

        <div className="live-control-bar">
          <div className="live-device-controls">{isLoggedIn ? <>
            <button type="button" className={`live-device-button ${cameraEnabled ? 'is-enabled' : ''}`} aria-pressed={cameraEnabled} disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('camera')}><LiveIcon name={cameraEnabled ? 'video' : 'videoOff'} size={21} /><span>{mediaBusy === 'camera' ? '切换中…' : cameraEnabled ? '关闭摄像头' : '开启摄像头'}</span></button>
            <button type="button" className={`live-device-button ${microphoneEnabled ? 'is-enabled' : ''}`} aria-pressed={microphoneEnabled} disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('microphone')}><LiveIcon name={microphoneEnabled ? 'mic' : 'micOff'} size={21} /><span>{mediaBusy === 'microphone' ? '切换中…' : microphoneEnabled ? '关闭麦克风' : '开启麦克风'}</span></button>
          </> : <span className="live-viewer-note"><LiveIcon name="screen" size={18} />观众模式</span>}
          {audioBlocked && <button type="button" className="live-button live-button-secondary" disabled={!isConnected} onClick={() => void enableAudio()}><LiveIcon name="volume" size={17} />播放声音</button>}</div>
          <button type="button" className="live-button live-button-leave" disabled={!isInRoom && !isJoining} onClick={() => void leaveRoom()}><LiveIcon name="leave" size={17} />离开房间</button>
        </div>
        {isInRoom && error && <div role="alert" className="live-notice live-notice-error"><LiveIcon name="info" /><p>{error}</p><button type="button" className="live-icon-button" aria-label="关闭提示" onClick={() => setError(null)}><LiveIcon name="close" size={16} /></button></div>}
        {isReconnecting && <div role="status" className="live-notice"><LiveIcon name="refresh" className="live-spin" /><p>连接暂时中断，正在尝试恢复。恢复后即可继续聊天和控制设备。</p></div>}
        <div className="live-studio-footer"><div><LiveIcon name="info" size={15} /><span>{isLoggedIn ? '摄像头和麦克风默认关闭，由你决定何时开启。' : '可以观看直播，也可以在聊天区发送消息。'}</span></div>{isLoggedIn && <button type="button" className="live-agent-button" disabled={!isConnected || isDispatchingAgent || agentRequested || hasAgent} onClick={() => void dispatchAgent()}><LiveIcon name="robot" size={16} />{isDispatchingAgent ? '呼叫中…' : hasAgent ? 'AI 助手已在线' : agentRequested ? '已呼叫，等待助手加入' : '呼叫 AI 助手'}</button>}</div>
      </div>

      <aside className="live-sidebar" aria-label="直播互动">
        <div className="live-sidebar-tabs"><button type="button" aria-pressed={sideTab === 'chat'} aria-controls="live-chat-panel" onClick={() => setSideTab('chat')}><LiveIcon name="chat" size={17} />聊天</button><button type="button" aria-pressed={sideTab === 'people'} aria-controls="live-people-panel" onClick={() => setSideTab('people')}><LiveIcon name="users" size={17} />在线 <span>{participants.length}</span></button></div>
        <div id="live-chat-panel" className="live-chat-panel" hidden={sideTab !== 'chat'}><LiveChat room={isInRoom ? roomRef.current : null} connected={isConnected} nickname={nickname} visible={sideTab === 'chat'} /></div>
        <div id="live-people-panel" className="live-people-panel" hidden={sideTab !== 'people'}>
          <h2>参与者 · {participants.length}</h2>
          {participants.length ? <ul>{participants.map((participant) => <li key={participant.identity}><span className={`live-avatar ${participant.role === '主播' ? 'is-host' : ''}`}>{participant.displayName.slice(0, 1)}</span><span className="live-person-name">{participant.displayName}{participant.isLocal && <small>（我）</small>}</span><RoleBadge role={participant.role} /></li>)}</ul> : <div className="live-people-empty"><LiveIcon name="users" size={28} /><p>连接后显示房间成员</p></div>}
        </div>
      </aside>
    </div>
  </>;
}
