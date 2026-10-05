'use client';

import { LiveIcon } from './live-icon';
import type { LiveVoice } from './use-live-voice';

export function LiveVoiceControls({ voice, connected }: { voice: LiveVoice; connected: boolean }) {
  const disabled = !connected || !voice.ready || voice.busy;
  if (voice.own && voice.slot?.status === 'approved') return <span className="live-viewer-note is-on-call"><LiveIcon name="check" size={17} />已加入连麦</span>;
  if (voice.own && voice.slot?.status === 'pending') return <div className="live-viewer-request"><span role="status">等待主播同意</span><button type="button" className="live-button live-button-secondary" disabled={disabled} onClick={() => void voice.act('cancel')}>取消申请</button></div>;
  return <button type="button" className="live-button live-button-primary" disabled={disabled || !!voice.slot || !voice.hasHost} onClick={() => void voice.act('request')}><LiveIcon name="mic" size={17} />{voice.busy ? '申请中…' : voice.slot?.status === 'pending' ? '已有观众申请中' : voice.slot ? '已有观众连麦中' : '申请连麦'}</button>;
}

export function LiveViewerCall({ voice, connected }: { voice: LiveVoice; connected: boolean }) {
  const devices = [
    { key: 'microphone', label: '麦克风', enabled: voice.microphoneEnabled, allowed: voice.canOpenMicrophone, icon: 'mic', offIcon: 'micOff', toggle: voice.toggleMicrophone },
    { key: 'camera', label: '摄像头', enabled: voice.cameraEnabled, allowed: voice.canOpenCamera, icon: 'video', offIcon: 'videoOff', toggle: voice.toggleCamera },
  ] as const;
  return <section className="live-viewer-call" aria-label="我的连麦">
    <div className="live-viewer-call-heading"><div><span className="live-call-dot" /><h2>我的连麦</h2><span className="live-call-mode">{voice.cameraEnabled ? '视频连麦' : '语音连麦'}</span></div><button type="button" className="live-call-end" disabled={!connected || voice.busy} onClick={() => void voice.act('end')}><LiveIcon name="leave" size={15} />退出连麦</button></div>
    <p className="live-viewer-call-intro">主播已同意。准备好后打开麦克风，也可以选择分享画面。</p>
    <div className="live-viewer-call-body">
      <div className="live-call-devices">{devices.map((device) => <div className="live-call-device" key={device.key}>
        <LiveIcon name={device.enabled ? device.icon : device.offIcon} size={20} />
        <div><strong>{device.label}</strong><span>{voice.mediaBusy === device.key ? '正在开启…' : device.enabled ? device.key === 'camera' ? '画面正在分享' : '大家可以听到你' : device.key === 'camera' ? '默认关闭，按需开启' : '已关闭，点击开麦'}</span></div>
        <button type="button" className="live-call-switch" role="switch" aria-label={device.label} aria-checked={device.enabled} disabled={!connected || (!device.enabled && (!!voice.mediaBusy || !voice.ready || voice.busy || !device.allowed))} onClick={() => void device.toggle()}><span /></button>
      </div>)}</div>
    </div>
    <p className="live-viewer-call-footnote"><LiveIcon name="users" size={14} />开启的声音和画面会分享给直播间所有人。退出连麦后继续观看。</p>
  </section>;
}

export function LiveVoicePanel({ voice, isHost, connected }: { voice: LiveVoice; isHost: boolean; connected: boolean }) {
  const slot = voice.slot;
  return <section className="live-voice-panel" aria-label="直播连麦">
    <div className="live-voice-heading"><LiveIcon name="mic" size={21} /><h2>{isHost ? '观众连麦' : '直播连麦'}</h2><span>{slot ? '1 / 1' : '0 / 1'}</span></div>
    <p className="live-voice-hint">一次仅一位观众可以申请或连麦，对方可自行开启麦克风和摄像头。</p>
    <div className="live-voice-card" role="status" aria-live="polite">
      {slot ? <><span className="live-avatar">{slot.name.slice(0, 1)}</span><strong>{slot.name}{voice.own ? '（我）' : ''}</strong><p>{slot.status === 'pending' ? '等待主播同意' : voice.speakerEnabled ? '连麦中 · 麦克风已开启' : voice.own ? '已获准，请在“我的连麦”中设置设备' : '已同意 · 麦克风未开启或已静音'}</p></>
        : <><LiveIcon name="micOff" size={30} /><strong>{!connected ? '连接后即可申请' : !voice.hasHost ? '等待主播进入房间' : '连麦席位空闲'}</strong><p>{isHost ? '观众申请后，你可以在这里同意或拒绝。' : '点击画面下方的“申请连麦”，等待主播同意。'}</p></>}
    </div>
    {isHost && slot && <div className="live-voice-actions">{slot.status === 'pending' ? <>
      <button type="button" className="live-button live-button-primary" disabled={!connected || voice.busy || !voice.ready} onClick={() => void voice.act('approve')}>同意连麦</button>
      <button type="button" className="live-button live-button-secondary" disabled={!connected || voice.busy || !voice.ready} onClick={() => void voice.act('reject')}>拒绝申请</button>
    </> : <button type="button" className="live-button live-button-danger" disabled={!connected || voice.busy} onClick={() => void voice.act('end')}>结束连麦</button>}</div>}
  </section>;
}
