'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { Sheet } from '@/components/sheet';
import { useViewport } from '@/components/use-viewport';
import { LiveIcon } from './live-icon';
import { useLiveLobby, type LiveLobbyProps, type LiveLobbyModel } from './use-live-lobby';
import { DesktopLiveLobbyFrame, MobileLiveLobbyFrame, LiveDirectoryFrame, LiveCreatePanelFrame, LiveLobbyLoadingContent, LiveDirectorySkeleton } from './live-lobby-frame';

export function LiveLobbyClient(props: LiveLobbyProps) {
  const model = useLiveLobby(props);
  const viewport = useViewport();
  const { creating, setCreating } = model;
  useEffect(() => { if (viewport === 'desktop') setCreating(false); }, [viewport, setCreating]);
  return <>
    {!viewport ? <LiveLobbyLoadingContent /> : viewport === 'desktop' ? <DesktopLiveLobby model={model} /> : <MobileLiveLobby model={model} onCreate={() => setCreating(true)} />}
    <Sheet open={creating && viewport === 'mobile'} onClose={() => setCreating(false)} title="我的直播间"><CreateRoomPanel model={model} /></Sheet>
    <CloseRoomDialog model={model} />
  </>;
}
function DesktopLiveLobby({ model }: { model: LiveLobbyModel }) {
  return <DesktopLiveLobbyFrame directory={<LobbyDirectory model={model} />} roomPanel={<CreateRoomPanel model={model} />} />;
}
function MobileLiveLobby({ model, onCreate }: { model: LiveLobbyModel; onCreate: () => void }) {
  return <MobileLiveLobbyFrame liveCount={model.liveCount} actions={model.ownedRoom ? <Link href={`/live/${encodeURIComponent(model.ownedRoom.id)}`} className="btn-primary">我的直播间</Link> : model.isLoggedIn ? <button type="button" onClick={onCreate} className="btn-primary">开播</button> : <Link href="/login" className="btn-secondary">登录开播</Link>}>
    <LobbyDirectory model={model} />
  </MobileLiveLobbyFrame>;
}

function LobbyDirectory({ model }: { model: LiveLobbyModel }) {
  const { roomsQuery, rooms, search, setSearch, filter, setFilter, setRoomToClose, setCloseError, isMutating, liveCount, visibleRooms, isLoggedIn } = model;
  return (      <LiveDirectoryFrame count={roomsQuery.isPending ? undefined : rooms.length} liveCount={roomsQuery.isPending ? undefined : liveCount} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} onRefresh={() => void roomsQuery.refetch()} refreshing={roomsQuery.isFetching} refreshDisabled={isMutating} result={!roomsQuery.isPending && `${visibleRooms.length} 个直播间${search || filter !== '全部' ? `，共 ${rooms.length} 个` : ''}`}>
        {roomsQuery.isError && <div role="alert" className="live-notice live-notice-error"><LiveIcon name="info" /><p>直播间列表更新失败，{roomsQuery.error.message}。请刷新列表重试。</p></div>}
        {roomsQuery.isPending ? <LiveDirectorySkeleton /> : visibleRooms.length ? <div className="live-room-grid">
          {visibleRooms.map((room) => <article className="live-room-card" key={room.id} data-browse-anchor={`room:${room.id}`} aria-label={room.title}>
            <Link href={`/live/${encodeURIComponent(room.id)}`} className={`live-room-cover ${room.status === '直播中' ? 'is-live' : ''}`} tabIndex={-1} aria-hidden="true">
              <span className={`live-status ${room.status === '直播中' ? 'is-on' : ''}`}><i />{room.status}</span>
              <div className="live-cover-symbol"><LiveIcon name={room.status === '直播中' ? 'play' : 'video'} size={30} /></div>
              <span className="live-cover-caption">{room.status === '直播中' ? '进入房间观看实时画面' : '即将开始 · 欢迎入座'}</span>
              <span className="live-cover-viewers"><LiveIcon name="users" size={13} />{room.viewers}</span>
            </Link>
            <div className="live-room-card-body"><h3 title={room.title}><Link href={`/live/${encodeURIComponent(room.id)}`}>{room.title}</Link></h3><p>{room.viewers} 人在房间</p>
              <div className="live-room-card-actions"><Link href={`/live/${encodeURIComponent(room.id)}`} className="live-enter-link">{isLoggedIn && room.canManage ? '进入直播间' : '观看'}<LiveIcon name="arrow" size={16} /></Link>{isLoggedIn && room.canManage && <button type="button" className="live-close-room" disabled={isMutating} aria-label={`关闭直播间：${room.title}`} onClick={() => { setCloseError(null); setRoomToClose(room); }}>关闭</button>}</div>
            </div>
          </article>)}
        </div> : !roomsQuery.isError && <div className="live-empty">
          <div className="live-empty-icon"><LiveIcon name={search ? 'search' : 'video'} size={30} /></div>
          <h3>{rooms.length ? '没有找到匹配的直播间' : '暂无直播间'}</h3>
          <p>{rooms.length ? '换个关键词，或看看其他状态的直播间。' : isLoggedIn ? '还没有人开播，创建一个直播间开始分享吧。' : '现在还没有人开播，过会儿再来看看。'}</p>
          {rooms.length > 0 && <button type="button" className="live-button live-button-secondary" onClick={() => { setSearch(''); setFilter('全部'); }}>查看全部直播间</button>}
        </div>}
      </LiveDirectoryFrame>
  );
}

function CreateRoomPanel({ model }: { model: LiveLobbyModel }) {
  const { roomsQuery, ownedRooms, ownedRoom, title, setTitle, isCreating, createdRoomId, error, setError, titleRef, isMutating, createRoom, isLoggedIn } = model;
  return (      <LiveCreatePanelFrame pending={roomsQuery.isPending} title={ownedRoom ? '我的直播间' : '创建直播间'} description={ownedRoom ? '每个账号同时只能保留一个直播间。' : '给房间起个名字，邀请大家来聊聊。'}>
        {ownedRoom ? <>
          <div className="live-created" role="status"><span><LiveIcon name="check" size={16} />{createdRoomId === ownedRoom.id ? '直播间已创建' : '你已有直播间'}</span><strong>{ownedRoom.title}</strong></div>
          <Link href={`/live/${encodeURIComponent(ownedRoom.id)}`} className="live-button live-button-primary live-create-button">进入我的直播间<LiveIcon name="arrow" size={16} /></Link>
          <p className="live-create-hint">{ownedRooms.length > 1 ? `你已有 ${ownedRooms.length} 个旧房间，请在列表中关闭多余房间。` : '关闭当前直播间后，才能创建新的房间。'}</p>
          {error && <p role="alert" className="live-form-error">{error}</p>}
        </> : isLoggedIn ? <form onSubmit={(event) => { event.preventDefault(); void createRoom(); }}>
          <label htmlFor="room-title">房间名称 <span>必填</span></label>
          <input id="room-title" aria-label="房间名称" required aria-invalid={!!error} aria-describedby={error ? "room-name-error" : "room-name-hint"} ref={titleRef} name="roomTitle" autoComplete="off" maxLength={100} disabled={isMutating || roomsQuery.isPending || roomsQuery.isError} value={title} onChange={(event) => { setTitle(event.target.value); setError(null); }} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} placeholder="例如：下班后，聊点有趣的" className="live-input" />
          <p id="room-name-hint" className="live-name-hint">1–100 个字符，不能与已有房间重名</p>
          <button type="submit" disabled={isMutating || roomsQuery.isPending || roomsQuery.isError} className="live-button live-button-primary live-create-button"><LiveIcon name="plus" size={17} />{isCreating ? '创建中…' : roomsQuery.isPending ? '正在确认房间…' : '创建直播间'}</button>
          <p className="live-create-hint">进入房间后，自行开启摄像头和麦克风。</p>
          {error && <p id="room-name-error" role="alert" className="live-form-error">{error}</p>}
        </form> : <><Link href="/login" className="live-button live-button-primary live-create-button">登录后创建<LiveIcon name="arrow" size={16} /></Link><p className="live-create-hint">观看直播和发送消息无需登录。</p></>}
      </LiveCreatePanelFrame>
  );
}

function CloseRoomDialog({ model }: { model: LiveLobbyModel }) {
  const { title, closingRoomId, roomToClose, setRoomToClose, error, closeError, dialogRef, closeRoom } = model;
  return (    <dialog ref={dialogRef} className="live-dialog" aria-labelledby="close-room-title" aria-describedby="close-room-description" onCancel={(event) => { if (closingRoomId) event.preventDefault(); else setRoomToClose(null); }} onClose={() => setRoomToClose(null)}>
      <h2 id="close-room-title">关闭这个直播间？</h2><p id="close-room-description">关闭「{roomToClose?.title}」后，所有参与者将断开连接。之后可以创建新的直播间。</p>
      {closeError && <p role="alert" className="live-form-error">{closeError}</p>}
      <div className="live-dialog-actions"><button autoFocus type="button" className="live-button live-button-secondary" disabled={closingRoomId !== null} onClick={() => setRoomToClose(null)}>取消</button><button type="button" className="live-button live-button-danger" disabled={closingRoomId !== null} onClick={() => void closeRoom()}>{closingRoomId ? '关闭中…' : '确认关闭'}</button></div>
    </dialog>
  );
}
