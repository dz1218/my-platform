'use client';

import { useEffect, useRef, useState } from 'react';
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

const roleMeta: Record<Role | 'AI助手', { badge: string; avatar: string }> = {
  主播: {
    badge: 'border border-emerald-400/30 bg-emerald-400/[0.15] text-emerald-400',
    avatar: 'border border-emerald-400/30 bg-emerald-400/[0.15] text-emerald-400',
  },
  观众: {
    badge: 'border border-slate-400/25 bg-slate-400/10 text-slate-400',
    avatar: 'border border-slate-400/25 bg-white/[0.06] text-slate-400',
  },
  AI助手: {
    badge: 'border border-brand-400/[0.35] bg-brand-500/[0.15] text-brand-300',
    avatar: 'border border-brand-400/[0.35] bg-brand-500/[0.15] text-brand-300',
  },
};

function RoleBadge({ role }: { role: Role | 'AI助手' }) {
  const m = roleMeta[role] ?? roleMeta['观众'];
  return (
    <span
      className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold tracking-[0.02em] ${m.badge}`}
    >
      {role}
    </span>
  );
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
    return 'WebRTC 建链失败。请检查：① VPN/代理是否关闭 ② 防火墙是否拦截 UDP 7882 ③ LiveKit 是否已启动。';
  }
  return message;
}

async function readApiError(response: Response) {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) return data.message.join('; ');
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
  } catch {
    // ignore
  }
  return `请求失败: ${response.status}`;
}

export function LiveRoomClient({ apiBaseUrl, roomId, isLoggedIn, hostNickname }: Props) {
  const role: Role = isLoggedIn ? '主播' : '观众';

  const [nickname, setNickname] = useState(() =>
    isLoggedIn ? hostNickname : Math.random().toString(36).slice(2, 7)
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isDispatchingAgent, setIsDispatchingAgent] = useState(false);

  const hasJoinedRef = useRef(false);
  const localIdentityRef = useRef('');
  const sessionSuffixRef = useRef(Math.random().toString(36).slice(2, 8));
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteMediaRef = useRef<HTMLDivElement>(null);

  const isConnected = connectionState === ConnectionState.Connected;
  const hasAgent = participants.some((p) => p.role === 'AI助手');
  const identityPrefix = role === '主播' ? 'host' : 'viewer';
  const rawIdentityName = nickname.trim().replace(/\s+/g, '_') || 'user';
  const maxIdentityNameLen = Math.max(1, 80 - identityPrefix.length - sessionSuffixRef.current.length - 2);
  const normalizedIdentityName = rawIdentityName.slice(0, maxIdentityNameLen);
  const computedIdentity = `${identityPrefix}_${normalizedIdentityName}_${sessionSuffixRef.current}`;

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
    remoteMediaRef.current.appendChild(element);
  }

  function detachTrack(track: Track) {
    track.detach().forEach((el) => el.remove());
  }

  function attachExistingRemoteTracks(room: Room) {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attachRemoteTrack(publication.track);
      }
    }
  }

  async function attachLocalVideoPreview() {
    const room = roomRef.current;
    if (!room || !localVideoRef.current) return;
    const pub = Array.from(room.localParticipant.videoTrackPublications.values()).find(
      (p) => p.track?.kind === Track.Kind.Video
    );
    if (!pub?.track) return;
    clearContainer(localVideoRef);
    const element = pub.track.attach();
    element.muted = true;
    styleVideoElement(element);
    localVideoRef.current.appendChild(element);
  }

  async function joinRoom() {
    setError(null);
    setIsJoining(true);
    try {
      const identity = computedIdentity;
      const name = nickname.trim() || identity;

      const joinResponse = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, name }),
      });
      if (!joinResponse.ok) throw new Error(await readApiError(joinResponse));

      const data = (await joinResponse.json()) as JoinResponse;
      localIdentityRef.current = data.identity;

      const room = new Room();
      room
        .on(RoomEvent.ConnectionStateChanged, (state) => {
          setConnectionState(state);
          if (state === ConnectionState.Connected) hasJoinedRef.current = true;
          if (state === ConnectionState.Disconnected && hasJoinedRef.current) {
            setError('连接已断开');
          }
        })
        .on(RoomEvent.ParticipantConnected, () => refreshParticipants(room))
        .on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(room))
        .on(RoomEvent.TrackSubscribed, (track) => attachRemoteTrack(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track))
        .on(RoomEvent.Disconnected, () => {
          setConnectionState(ConnectionState.Disconnected);
          setParticipants([]);
          if (hasJoinedRef.current) setError('房间连接已关闭');
        });

      await room.connect(data.livekitUrl, data.token);
      roomRef.current = room;
      hasJoinedRef.current = true;
      refreshParticipants(room);
      attachExistingRemoteTracks(room);
    } catch (err) {
      setError(err instanceof Error ? normalizeError(err.message) : '加入房间失败');
    } finally {
      setIsJoining(false);
    }
  }

  async function enableLocalMedia() {
    setError(null);
    try {
      const room = roomRef.current;
      if (!room) throw new Error('尚未连接房间');
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      await attachLocalVideoPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : '开启音视频失败');
    }
  }

  async function dispatchAgent() {
    setError(null);
    setIsDispatchingAgent(true);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}/agent/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error(await readApiError(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : '派发 AI 助手失败');
    } finally {
      setIsDispatchingAgent(false);
    }
  }

  async function leaveRoom() {
    const room = roomRef.current;
    if (!room) return;
    room.disconnect();
    roomRef.current = null;
    hasJoinedRef.current = false;
    localIdentityRef.current = '';
    setParticipants([]);
    setConnectionState(ConnectionState.Disconnected);
    clearContainer(localVideoRef);
    clearContainer(remoteMediaRef);
  }

  useEffect(() => {
    return () => {
      void leaveRoom();
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !roomRef.current || !remoteMediaRef.current) return;
    attachExistingRemoteTracks(roomRef.current);
  }, [isConnected, participants.length]);

  return (
    <div className="grid gap-3.5">
      <section className="glass-card p-6">
        {!isConnected ? (
          <>
            <div className="mb-5 inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2">
              {isLoggedIn ? (
                <div className="badge-success">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#34D399"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                  <span>以主播身份加入 · {hostNickname}</span>
                </div>
              ) : (
                <div className="badge-muted">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#94A3B8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>以观众身份加入</span>
                </div>
              )}
            </div>

            {!isLoggedIn && (
              <div className="mb-5">
                <label className="grid gap-[7px]">
                  <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">昵称</span>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    disabled={isJoining}
                    placeholder="输入你的昵称"
                    className="input-glass max-w-[300px]"
                  />
                </label>
              </div>
            )}

            <button
              type="button"
              onClick={() => void joinRoom()}
              disabled={isJoining}
              className={`${isLoggedIn ? 'btn-emerald' : 'btn-indigo'} px-7 py-3`}
            >
              {isJoining ? (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="animate-spin"
                  >
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  连接中...
                </>
              ) : (
                <>
                  {isLoggedIn ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" />
                    </svg>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
                    </svg>
                  )}
                  {isLoggedIn ? '开始直播' : '进入观看'}
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <div className="mb-[18px] flex flex-wrap items-center gap-2.5 rounded-[10px] border border-emerald-400/20 bg-emerald-400/[0.08] px-3.5 py-2.5">
              <span className="online-dot" />
              <span className="text-[13px] font-semibold text-emerald-300">已连接</span>
              <RoleBadge role={role} />
              <span className="text-[13px] text-slate-400">{nickname}</span>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {role === '主播' && (
                <button type="button" onClick={() => void enableLocalMedia()} className="btn-glass">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                  开启摄像头/麦克风
                </button>
              )}

              <button
                type="button"
                onClick={() => void dispatchAgent()}
                disabled={isDispatchingAgent || hasAgent}
                className={`inline-flex items-center gap-1.5 rounded-[10px] border px-4 py-2.5 text-[13px] font-medium transition-colors ${
                  hasAgent
                    ? 'cursor-not-allowed border-brand-400/20 bg-brand-500/[0.08] text-brand-300/70'
                    : 'border-brand-400/[0.35] bg-brand-500/[0.15] text-brand-300 hover:bg-brand-500/25'
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4M12 15v2" />
                </svg>
                {isDispatchingAgent ? '呼叫中...' : hasAgent ? 'AI 助手已在线' : '呼叫 AI 助手'}
              </button>

              <button type="button" onClick={() => void leaveRoom()} className="btn-danger-ghost">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                {role === '主播' ? '结束直播' : '离开房间'}
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="mt-3.5 flex items-start gap-2 rounded-[10px] border border-rose-500/20 bg-rose-500/10 px-3.5 py-3">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FCA5A5"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="m-0 text-[13px] leading-6 text-rose-300">{error}</p>
          </div>
        )}
      </section>

      {isConnected && participants.length > 0 && (
        <section className="glass-card-soft px-[22px] py-5">
          <div className="mb-4 flex items-center gap-2">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748B"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.04em] text-slate-500">
              参与者 · {participants.length}
            </h3>
          </div>

          <div className="grid gap-2">
            {participants.map((p) => {
              const m = roleMeta[p.role] ?? roleMeta['观众'];
              const initial = (p.displayName[0] ?? '?').toUpperCase();

              return (
                <div
                  key={p.identity}
                  className={`flex items-center gap-3 rounded-[10px] px-2.5 py-2 ${
                    p.isLocal ? 'border border-white/10 bg-white/[0.04]' : 'border border-transparent'
                  }`}
                >
                  <div
                    className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${m.avatar}`}
                  >
                    {initial}
                  </div>
                  <span className="flex-1 text-sm font-medium text-slate-200">
                    {p.displayName}
                    {p.isLocal && <span className="ml-1.5 text-xs font-normal text-slate-600">（我）</span>}
                  </span>
                  <RoleBadge role={p.role} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isConnected && (
        <section className="glass-card-soft px-[22px] py-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-1.5">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#64748B"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="10" r="3" />
                  <path d="M7 20.662V19a2 2 0 012-2h6a2 2 0 012 2v1.662" />
                </svg>
                <h3 className="m-0 text-xs font-bold uppercase tracking-[0.04em] text-slate-500">本地预览</h3>
              </div>
              <div
                ref={localVideoRef}
                className="min-h-11 rounded-[10px] border border-dashed border-white/10 bg-white/[0.03]"
              />
            </div>

            <div>
              <div className="mb-3 flex items-center gap-1.5">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#64748B"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
                <h3 className="m-0 text-xs font-bold uppercase tracking-[0.04em] text-slate-500">远端媒体</h3>
              </div>
              <div
                ref={remoteMediaRef}
                className="flex min-h-11 flex-wrap gap-2.5 rounded-[10px] border border-dashed border-white/10 bg-white/[0.03] p-1"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
