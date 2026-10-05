'use client';

import { useEffect, useRef, useState } from 'react';
import { ParticipantKind, RoomEvent, Track, type Participant, type Room } from 'livekit-client';
import { LiveIcon } from './live-icon';
import type { VoiceSlot } from './use-live-voice';

type Camera = { track: Track | null; name: string; local: boolean };
type Props = {
  room: Room | null;
  isHost: boolean;
  slot: VoiceSlot | null;
  cameraDisabled: boolean;
  onEnableCamera: () => void;
};

function readCamera(participant: Participant | undefined, room: Room): Camera {
  const publication = participant?.getTrackPublication(Track.Source.Camera);
  return {
    track: publication && !publication.isMuted ? publication.track ?? null : null,
    name: participant?.name || '',
    local: participant === room.localParticipant,
  };
}

function CameraVideo({ camera, label }: { camera: Camera; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = camera.track;
    if (!track || !ref.current) return;
    const video = track.attach();
    video.muted = camera.local;
    video.classList.add('live-media-track');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('aria-label', label);
    ref.current.appendChild(video);
    return () => { track.detach(video); video.remove(); };
  }, [camera.track, camera.local, label]);
  return <div ref={ref} className={`live-camera-video ${camera.local ? 'is-local' : ''}`} />;
}

export function LiveStageMedia({ room, isHost, slot, cameraDisabled, onEnableCamera }: Props) {
  const [cameras, setCameras] = useState<{ host: Camera | null; caller: Camera | null }>({ host: null, caller: null });
  const [focusedCall, setFocusedCall] = useState<string | null>(null);
  const call = room && slot?.status === 'approved' ? slot : null;
  const callerIsMain = !!call && focusedCall === call.requestId;
  const ownCall = !!call && call.identity === room?.localParticipant.identity;

  useEffect(() => {
    if (!room) {
      setCameras({ host: null, caller: null });
      setFocusedCall(null);
      return;
    }
    const sync = () => {
      const people = [room.localParticipant, ...room.remoteParticipants.values()];
      const host = people.find((person) => person.kind !== ParticipantKind.AGENT && person.identity.startsWith('host_'));
      const caller = people.find((person) => person.identity === slot?.identity && person.sid === slot?.participantSid);
      setCameras({ host: readCamera(host, room), caller: readCamera(caller, room) });
    };
    const events = [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantNameChanged, RoomEvent.Reconnected] as const;
    events.forEach((event) => room.on(event, sync));
    sync();
    return () => { events.forEach((event) => room.off(event, sync)); };
  }, [room, slot?.identity, slot?.participantSid]);

  const swap = () => { if (call) setFocusedCall(callerIsMain ? null : call.requestId); };
  const hasVideo = !!cameras.host?.track || (!!call && !!cameras.caller?.track);
  return <>
    <div className="live-stage-top">
      <span><LiveIcon name="video" size={15} />{call ? '连麦画面' : isHost ? '本地预览' : '直播画面'}</span>
      {call ? <button type="button" className="live-stage-swap" onClick={swap}><LiveIcon name="swap" size={15} />切换大小画面</button>
        : <span>{room ? hasVideo ? '实时画面' : '等待画面' : '尚未连接'}</span>}
    </div>
    {room && <div className={`live-stage-media ${call ? 'has-call' : ''}`}>
      <div className={`live-camera-pane ${callerIsMain ? 'is-small' : 'is-main'}`} role="group" aria-label="主播画面">
        {cameras.host?.track ? <CameraVideo camera={cameras.host} label="主播画面" />
          : <div className="live-stage-empty">
            <div className="live-stage-symbol"><LiveIcon name={isHost ? 'videoOff' : 'screen'} size={36} /></div>
            <h2>{isHost ? '摄像头尚未开启' : '等主播开启画面'}</h2>
            {!callerIsMain && <><p>{isHost ? '准备好后，开启摄像头与大家见面。' : '先聊聊天，画面准备好后会自动显示。'}</p>
              {isHost && <button type="button" className="live-button live-button-stage" disabled={cameraDisabled} onClick={onEnableCamera}><LiveIcon name="video" size={16} />打开画面</button>}</>}
          </div>}
        <span className="live-camera-label">主播{cameras.host?.name ? ` · ${cameras.host.name}` : ''}{isHost ? '（我）' : ''}</span>
        {callerIsMain && <button type="button" className="live-camera-swap" aria-label="将主播切换到大画面" title="点击切换到大画面" onClick={swap}><LiveIcon name="swap" size={16} /></button>}
      </div>
      {call && <div className={`live-camera-pane ${callerIsMain ? 'is-main' : 'is-small'}`} role="group" aria-label="连麦者画面">
        {cameras.caller?.track ? <CameraVideo camera={cameras.caller} label={ownCall ? '我的连麦画面' : '连麦者画面'} />
          : <div className="live-stage-empty"><div className="live-stage-symbol"><LiveIcon name="videoOff" size={36} /></div><h2>摄像头未开启</h2>{callerIsMain && <p>{ownCall ? '可以在下方打开摄像头，分享你的画面。' : '对方开启摄像头后，画面会自动显示。'}</p>}</div>}
        <span className="live-camera-label">{ownCall ? '我的画面' : `连麦 · ${call.name}`}</span>
        {!callerIsMain && <button type="button" className="live-camera-swap" aria-label="将连麦者切换到大画面" title="点击切换到大画面" onClick={swap}><LiveIcon name="swap" size={16} /></button>}
      </div>}
    </div>}
  </>;
}
