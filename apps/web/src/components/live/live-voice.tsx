'use client';

import { LiveIcon } from './live-icon';
import type { LiveVoice } from './use-live-voice';

export function LiveVoiceControls({ voice, connected }: { voice: LiveVoice; connected: boolean }) {
  const disabled = !connected || !voice.ready || voice.busy;
  if (voice.own && voice.slot?.status === 'approved') return <LiveCallControls voice={voice} connected={connected} />;
  if (voice.own && voice.slot?.status === 'pending') return <div className="live-viewer-request"><span role="status">等待主播同意</span><button type="button" className="live-button live-button-secondary" disabled={disabled} onClick={() => void voice.act('cancel')}>取消申请</button></div>;
  return <button type="button" className="live-button live-button-primary" disabled={disabled || !!voice.slot || !voice.hasHost} onClick={() => void voice.act('request')}><LiveIcon name="mic" size={17} />{voice.busy ? '申请中…' : voice.slot?.status === 'pending' ? '已有观众申请中' : voice.slot ? '已有观众连麦中' : '申请连麦'}</button>;
}

function LiveCallControls({ voice, connected }: { voice: LiveVoice; connected: boolean }) {
  const devices = [
    { key: 'camera', label: '摄像头', enabled: voice.cameraEnabled, allowed: voice.canOpenCamera, icon: 'video', offIcon: 'videoOff', toggle: voice.toggleCamera },
    { key: 'microphone', label: '麦克风', enabled: voice.microphoneEnabled, allowed: voice.canOpenMicrophone, icon: 'mic', offIcon: 'micOff', toggle: voice.toggleMicrophone },
  ] as const;
  return <section className="flex min-w-0 flex-wrap items-center gap-2" aria-label="我的连麦">
    <p className="sr-only">主播已同意连麦。开启的声音和画面会分享给直播间所有人，退出连麦后继续观看。</p>
    {devices.map((device) => <button
      key={device.key}
      type="button"
      className={`inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-control px-3 text-sm whitespace-nowrap md:max-xl:px-2 ${device.enabled ? 'bg-action text-on-action hover:bg-action-hover' : 'bg-surface-soft text-ink hover:bg-surface-hover'}`}
      role="switch"
      aria-label={device.label}
      aria-checked={device.enabled}
      aria-busy={voice.mediaBusy === device.key}
      title={device.enabled ? `关闭${device.label}` : `开启${device.label}，分享给直播间所有人`}
      disabled={!connected || (!device.enabled && (!!voice.mediaBusy || !voice.ready || voice.busy || !device.allowed))}
      onClick={() => void device.toggle()}
    >
      <LiveIcon name={device.enabled ? device.icon : device.offIcon} size={21} />
      <span>{voice.mediaBusy === device.key ? '切换中…' : <><span className="md:max-xl:hidden">{device.enabled ? '关闭' : '开启'}</span>{device.label}</>}</span>
    </button>)}
  </section>;
}

export function LiveVoicePanel({ voice, isHost, connected }: { voice: LiveVoice; isHost: boolean; connected: boolean }) {
  const slot = voice.slot;
  return <section className="live-voice-panel" aria-label="直播连麦">
    <div className="live-voice-heading"><LiveIcon name="mic" size={21} /><h2>{isHost ? '观众连麦' : '直播连麦'}</h2><span>{slot ? '1 / 1' : '0 / 1'}</span></div>
    <p className="live-voice-hint">一次仅一位观众可以申请或连麦，对方可自行开启麦克风和摄像头。</p>
    <div className="live-voice-card" role="status" aria-live="polite">
      {slot ? <><span className="live-avatar">{slot.name.slice(0, 1)}</span><strong>{slot.name}{voice.own ? '（我）' : ''}</strong><p>{slot.status === 'pending' ? '等待主播同意' : voice.speakerEnabled ? '连麦中 · 麦克风已开启' : voice.own ? '已获准，可自行开启麦克风和摄像头' : '已同意 · 麦克风未开启或已静音'}</p></>
        : <><LiveIcon name="micOff" size={30} /><strong>{!connected ? '连接后即可申请' : !voice.hasHost ? '等待主播进入房间' : '连麦席位空闲'}</strong><p>{isHost ? '观众申请后，你可以在这里同意或拒绝。' : '点击画面下方的“申请连麦”，等待主播同意。'}</p></>}
    </div>
    {isHost && slot && <div className="live-voice-actions">{slot.status === 'pending' ? <>
      <button type="button" className="live-button live-button-primary" disabled={!connected || voice.busy || !voice.ready} onClick={() => void voice.act('approve')}>同意连麦</button>
      <button type="button" className="live-button live-button-secondary" disabled={!connected || voice.busy || !voice.ready} onClick={() => void voice.act('reject')}>拒绝申请</button>
    </> : <button type="button" className="live-button live-button-danger" disabled={!connected || voice.busy} onClick={() => void voice.act('end')}>结束连麦</button>}</div>}
  </section>;
}
