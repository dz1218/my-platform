'use client';
import Link from 'next/link';
import { memo } from 'react';
import { useDialogScrollLock } from '@my-platform/web-ui/dialog-scroll-lock';
import { LiveIcon } from './live-icon';
import { LiveChat } from './live-chat';
import { LiveManagementToolbar, LiveManagementPanels, LiveGovernedMembers } from './live-management';
import { LiveAssistantControls } from './live-assistant';
import { LiveVoiceControls, LiveVoicePanel } from './live-voice';
import { LiveViewerLeave } from './live-viewer-leave';
import { LiveStageMedia } from './live-stage-media';
import { LiveConnectionPending, LiveRoomTitle, LiveRoomControlsLoading } from './live-room-loading';
import { MobileLiveControls, MobileLiveLeave, MobileLiveRoomHeader, MobileLiveRoomPanels } from '@my-platform/mobile-web/live-room';
import { useViewport } from '@/components/use-viewport';
import { useLiveRoom, type LiveRoomProps } from './use-live-room';

export function LiveRoomClient(props: LiveRoomProps) {
  const viewport = useViewport();
  const model = useLiveRoom(props);
  return <><LiveRoomScene model={model} viewport={viewport} /><EndRoomDialog model={model} /><LiveManagementPanels model={model.governance} /></>;
}

// Keep the outgoing scene stable while the confirmed return finishes. The owner
// still processes SDK events and releases resources; failures reveal current state.
const LiveRoomScene = memo(function LiveRoomScene({ model, viewport }: {
  model: ReturnType<typeof useLiveRoom>;
  viewport: ReturnType<typeof useViewport>;
}) {
  const { governance, roomBanned, roomTitle, roomTitlePending, roomEnded, roomInUse, hostRecovering, recovering, returnToHall, roomReason, setCloseConfirmOpen, isClosing, refreshRoom, isRefreshing, refreshError, role, isHost, participants, error, setError, connectionPending, isDispatchingAgent, mediaBusy, cameraEnabled, microphoneEnabled, audioBlocked, sideTab, setSideTab, notice, isFullscreen, stageRef, roomRef, remoteAudioRef, isConnected, isReconnecting, isInRoom, hasAgent, assistant, voice, joinRoom, toggleLocalMedia, dispatchAgent, removeAgent, leaveRoom, enableAudio, shareRoom, toggleFullscreen } = model;
  const closeMobileMembers = () => { if (viewport === 'mobile') setSideTab('chat'); };
  const isTerminal = roomEnded || roomInUse || roomBanned;
  const joining = !isInRoom && connectionPending && !isTerminal;
  const hasOwnCall = !isHost && isInRoom && voice.own && voice.slot?.status === 'approved';
  const terminalMessage = roomBanned ? '你已被移出，本场直播内不可重新进入。' : roomEnded ? roomReason === 'host_left' ? '主播已离开，直播间已结束。' : '直播间已结束，请返回直播大厅。'
    : roomInUse ? '你已在另一个页面或设备进入此直播间，请使用原页面继续直播。'
      : '主播连接已断开，正在确认直播间结束状态。';
  return <>
    <div className="live-room-back hidden md:flex"><button type="button" disabled={isClosing} onClick={returnToHall} aria-label="返回大厅" title="返回大厅" className="live-header-back"><span className="live-header-back-icon"><LiveIcon name="back" size={21} /></span><span>返回大厅</span></button></div>
    {viewport !== 'desktop' && <div className="md:hidden"><MobileLiveRoomHeader
      back={<button type="button" onClick={returnToHall} disabled={isClosing} aria-label="返回直播大厅" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-soft"><LiveIcon name="back" size={21} /></button>}
      title={roomTitle} pendingTitle={roomTitlePending} role={role} status={isReconnecting ? '正在重连…' : isConnected ? '已连接' : connectionPending ? '连接中' : '未连接'}
      count={isInRoom ? participants.length : null} onRefresh={roomEnded || isClosing ? undefined : () => void refreshRoom()} refreshing={isRefreshing} onShare={() => void shareRoom()}
    /></div>}
    {notice && <div role="status" className="live-toast"><LiveIcon name="info" size={16} />{notice}</div>}
    {refreshError && !roomEnded && <div role="alert" className="live-notice live-notice-error"><LiveIcon name="info" /><p>{refreshError}</p><button type="button" className="live-button live-button-secondary" disabled={isRefreshing || isClosing} onClick={() => void refreshRoom()}>{isRefreshing ? '正在同步…' : '重新同步'}</button></div>}

    <div className="live-studio">
      <div className="live-stage-column">
        <div className="live-stage" ref={stageRef} data-connecting={joining || undefined}>
          {viewport !== 'mobile' && <header className="live-studio-heading hidden md:flex">
      <div className="live-room-title"><LiveRoomTitle title={roomTitlePending ? undefined : roomTitle} /><span className={`live-connection ${isConnected ? 'is-connected' : ''}`} role="status"><i />{isReconnecting ? '正在重连…' : isConnected ? '已连接' : connectionPending ? '连接中' : '未连接'}</span></div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" className="live-button live-button-secondary" aria-label="分享直播间" onClick={() => void shareRoom()}><LiveIcon name="link" size={16} />分享</button>
      </div>
    </header>}
          <LiveStageMedia room={isInRoom && !isTerminal ? roomRef.current : null} isHost={isHost} hostRecovering={hostRecovering} slot={voice.slot} cameraDisabled={!isConnected || mediaBusy !== null} onEnableCamera={() => void toggleLocalMedia('camera')} />
          <div ref={remoteAudioRef} hidden />
          {joining && <LiveConnectionPending label={recovering ? '正在恢复直播连接' : '正在连接直播间'} />}
          {(isTerminal || (!isInRoom && !connectionPending)) && <div className="live-stage-empty">
            <h2>{roomBanned ? '已被移出直播间' : roomEnded ? '直播间已结束' : roomInUse ? '此直播间已在其他页面打开' : error ? '暂时无法进入直播间' : '你已离开直播间'}</h2>
            {isTerminal ? <p role="status">{terminalMessage}</p> : error ? <p role="alert">{error}</p> : <p>摄像头和麦克风已关闭，随时可以重新加入。</p>}
            <div className="live-stage-actions">{isTerminal ? <Link href="/" className="live-button live-button-light"><LiveIcon name="back" size={16} />返回直播大厅</Link> : <button type="button" className="live-button live-button-light" onClick={() => void joinRoom()}><LiveIcon name="refresh" size={16} />重新加入</button>}</div>
          </div>}
          <div className={`live-stage-bottom ${joining ? 'invisible' : ''}`} aria-hidden={joining || undefined}><button type="button" className="live-icon-button" title={isFullscreen ? '退出全屏' : '全屏观看'} aria-label={isFullscreen ? '退出全屏' : '全屏观看'} onClick={() => void toggleFullscreen()}><LiveIcon name="expand" size={18} /></button></div>
        </div>

        {!isTerminal && (viewport === 'mobile' ? <MobileLiveControls host={isHost} joining={joining} connected={isConnected}
          callStatus={voice.own ? voice.slot?.status : null}
          devices={<>{isHost ? <>
            <button type="button" className={`live-device-button ${cameraEnabled ? 'is-enabled' : ''}`} aria-pressed={cameraEnabled} disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('camera')}><LiveIcon name={cameraEnabled ? 'video' : 'videoOff'} size={21} /><span>{mediaBusy === 'camera' ? '切换中…' : cameraEnabled ? '关闭摄像头' : '开启摄像头'}</span></button>
            <button type="button" className={`live-device-button ${microphoneEnabled ? 'is-enabled' : ''}`} aria-pressed={microphoneEnabled} disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('microphone')}><LiveIcon name={microphoneEnabled ? 'mic' : 'micOff'} size={21} /><span>{mediaBusy === 'microphone' ? '切换中…' : microphoneEnabled ? '关闭麦克风' : '开启麦克风'}</span></button>
          </> : role === '观众' ? <LiveVoiceControls voice={voice} connected={isConnected && !governance.data?.self?.mute} /> : joining ? <LiveRoomControlsLoading /> : <span className="live-viewer-note">加入成功后显示房间操作</span>}
</>}
          error={joining ? null : error || voice.error} sharing={cameraEnabled || microphoneEnabled}
          playback={audioBlocked && <button type="button" className="live-button live-button-primary" disabled={!isConnected} onClick={() => void enableAudio()}><LiveIcon name="volume" size={17} />播放声音</button>}
          leave={<MobileLiveLeave joining={joining} host={isHost} disabled={(!isInRoom && !connectionPending) || isClosing} onLeave={() => joining ? void leaveRoom() : isHost ? setCloseConfirmOpen(true) : void leaveRoom()} onEndCall={hasOwnCall ? () => void voice.act('end') : undefined} endCallDisabled={!isConnected || voice.busy} />} assistant={isHost ? <LiveAssistantControls assistant={assistant} connected={isConnected && !isTerminal} busy={isDispatchingAgent} onCall={dispatchAgent} onRemove={removeAgent} /> : undefined} /> : <div className="live-control-bar"><div className="live-device-controls">{isHost ? <>
            <button type="button" className={`live-device-button ${cameraEnabled ? 'is-enabled' : ''}`} aria-pressed={cameraEnabled} disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('camera')}><LiveIcon name={cameraEnabled ? 'video' : 'videoOff'} size={21} /><span>{mediaBusy === 'camera' ? '切换中…' : cameraEnabled ? '关闭摄像头' : '开启摄像头'}</span></button>
            <button type="button" className={`live-device-button ${microphoneEnabled ? 'is-enabled' : ''}`} aria-pressed={microphoneEnabled} disabled={!isConnected || mediaBusy !== null} onClick={() => void toggleLocalMedia('microphone')}><LiveIcon name={microphoneEnabled ? 'mic' : 'micOff'} size={21} /><span>{mediaBusy === 'microphone' ? '切换中…' : microphoneEnabled ? '关闭麦克风' : '开启麦克风'}</span></button>
          </> : role === '观众' ? <LiveVoiceControls voice={voice} connected={isConnected && !governance.data?.self?.mute} /> : joining ? <LiveRoomControlsLoading /> : <span className="live-viewer-note">加入成功后显示房间操作</span>}
          {audioBlocked && <button type="button" className="live-button live-button-secondary" disabled={!isConnected} onClick={() => void enableAudio()}><LiveIcon name="volume" size={17} />播放声音</button>}</div>{!joining && !isHost ? <LiveViewerLeave hasCall={hasOwnCall} disabled={!isInRoom || isClosing} endCallDisabled={!isConnected || voice.busy} onEndCall={() => void voice.act('end')} onLeave={() => void leaveRoom()} /> : <button type="button" className="live-button live-button-leave" disabled={(!isInRoom && !connectionPending) || isClosing} onClick={() => joining ? void leaveRoom() : setCloseConfirmOpen(true)}><LiveIcon name="leave" size={17} />{joining ? '取消连接' : '结束直播'}</button>}</div>)}
        {isInRoom && error && <div role="alert" className="live-notice live-notice-error"><LiveIcon name="info" /><p>{error}</p><button type="button" className="live-icon-button" aria-label="关闭提示" onClick={() => setError(null)}><LiveIcon name="close" size={16} /></button></div>}
        {isInRoom && voice.error && <div role="alert" className="live-notice live-notice-error"><LiveIcon name="info" /><p>{voice.error}</p><button type="button" className="live-agent-button" disabled={!isConnected || voice.busy} onClick={() => void voice.refresh()}>重试连麦状态</button><button type="button" className="live-icon-button" aria-label="关闭连线提示" onClick={voice.dismissError}><LiveIcon name="close" size={16} /></button></div>}
        {isReconnecting && <div role="status" className="live-notice"><LiveIcon name="refresh" className="live-spin" /><p>连接暂时中断，正在尝试恢复。恢复后即可继续聊天和控制设备。</p></div>}
        {viewport !== 'mobile' && <div className="live-studio-footer hidden md:flex" data-pending={joining || undefined}>{isHost && <LiveAssistantControls assistant={assistant} connected={isConnected && !isTerminal} busy={isDispatchingAgent} onCall={dispatchAgent} onRemove={removeAgent} />}</div>}
      </div>

      <aside className="live-sidebar" aria-label="直播互动">
        <LiveManagementToolbar model={governance} />
        {viewport !== 'mobile' && <div className="live-sidebar-tabs"><button type="button" aria-pressed={sideTab === 'chat'} aria-controls="live-chat-panel" onClick={() => setSideTab('chat')}><LiveIcon name="chat" size={17} />聊天</button><button type="button" aria-pressed={sideTab === 'people'} aria-controls="live-people-panel" onClick={() => setSideTab('people')}><LiveIcon name="users" size={17} />在线 <span>{participants.length}</span></button>{isHost && <button type="button" aria-pressed={sideTab === 'voice'} aria-controls="live-voice-panel" onClick={() => setSideTab('voice')}><LiveIcon name="mic" size={17} />连麦{voice.slot && <span className="live-voice-badge">1</span>}</button>}</div>}
        <div id="live-chat-panel" className="live-chat-panel" hidden={viewport !== 'mobile' && sideTab !== 'chat'}><LiveChat governance={governance} assistantOnline={hasAgent} pending={joining} connected={isConnected && !isTerminal} /></div>
        {viewport === 'mobile' ? <MobileLiveRoomPanels selected={sideTab} onSelect={setSideTab}
          participantCount={participants.length} isHost={isHost} hasVoice={!!voice.slot}
          members={<>        <div id="live-people-panel" className="live-people-panel" >
          <h2>参与者 · {participants.length}</h2>
          <LiveGovernedMembers model={governance} onSelect={closeMobileMembers} />
        </div></>}
          voice={<div id="live-voice-panel" className="live-voice-container"><LiveVoicePanel voice={voice} isHost={isHost} connected={isConnected} /></div>}
        /> : <>        {isHost && <div id="live-voice-panel" className="live-voice-container" hidden={sideTab !== 'voice'}><LiveVoicePanel voice={voice} isHost={isHost} connected={isConnected} /></div>}
        <div id="live-people-panel" className="live-people-panel" hidden={sideTab !== 'people'}>
          <h2>参与者 · {participants.length}</h2>
          <LiveGovernedMembers model={governance} onSelect={closeMobileMembers} />
        </div></>}
      </aside>
    </div>
  </>;
}, (_previous, next) => next.model.returnToLobby && next.model.isClosing);

function EndRoomDialog({ model }: { model: ReturnType<typeof useLiveRoom> }) {
  useDialogScrollLock(model.closeDialogRef);
  const { closeDialogRef, isClosing, setCloseConfirmOpen, returnToLobby, closeError, endRoom } = model;
  return (
    <dialog ref={closeDialogRef} className="live-dialog live-dialog-confirm" aria-label={returnToLobby ? '结束直播？' : '结束这个直播间？'} aria-describedby="end-live-description" onCancel={event => { if (isClosing) event.preventDefault(); else setCloseConfirmOpen(false); }} onClose={() => setCloseConfirmOpen(false)}>
      <p id="end-live-description">{returnToLobby ? '结束直播并返回大厅？' : '结束直播后，所有人将离开直播间。'}</p>
      {closeError && <p role="alert" className="live-form-error">{closeError}</p>}
      <div className="live-dialog-actions"><button autoFocus type="button" className="live-button live-button-secondary" disabled={isClosing} onClick={() => setCloseConfirmOpen(false)}>{returnToLobby ? '继续直播' : '取消'}</button><button type="button" className="live-button live-button-danger" disabled={isClosing} onClick={() => void endRoom()}>{isClosing ? '正在结束…' : returnToLobby ? '结束直播' : '确认结束'}</button></div>
    </dialog>
  );
}
