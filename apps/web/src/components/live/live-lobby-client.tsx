'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiRoomItem } from '@/lib/api';
import { check } from '@/services/api/client';
import { LiveIcon } from './live-icon';

type Props = {
  apiBaseUrl: string;
  initialRooms: ApiRoomItem[] | undefined;
  isLoggedIn: boolean;
  hostNickname: string;
};

type Filter = '全部' | '直播中' | '准备中';

export function LiveLobbyClient({ apiBaseUrl, initialRooms, isLoggedIn, hostNickname }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['live-rooms', apiBaseUrl];
  const roomsQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${apiBaseUrl}/rooms`, { cache: 'no-store', signal });
      await check(response);
      return ((await response.json()) as { items: ApiRoomItem[] }).items;
    },
    initialData: initialRooms,
    initialDataUpdatedAt: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 5_000,
  });
  const rooms = roomsQuery.data ?? [];
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('全部');
  const [isCreating, setIsCreating] = useState(false);
  const [closingRoomId, setClosingRoomId] = useState<string | null>(null);
  const [roomToClose, setRoomToClose] = useState<ApiRoomItem | null>(null);
  const [createdRoom, setCreatedRoom] = useState<ApiRoomItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const isMutating = isCreating || closingRoomId !== null;
  const liveCount = rooms.filter((room) => room.status === '直播中').length;
  const visibleRooms = rooms.filter((room) => (filter === '全部' || room.status === filter) && room.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (roomToClose) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [roomToClose]);

  async function createRoom() {
    if (mutationPending.current) return;
    const name = title.trim();
    if (!name || name.length > 100) {
      setError('请输入 1–100 个字符的房间名称');
      titleRef.current?.focus();
      return;
    }
    if (rooms.some((room) => room.title.trim().toLowerCase() === name.toLowerCase())) {
      setError('这个房间名称已被使用，请换一个名称');
      titleRef.current?.focus();
      return;
    }
    mutationPending.current = true;
    setError(null);
    setIsCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name }),
      });
      await check(response);
      const { item } = (await response.json()) as { item: ApiRoomItem };
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => [item, ...current.filter((room) => room.id !== item.id)]);
      setTitle('');
      setSearch('');
      setFilter('全部');
      setCreatedRoom(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败，请重试');
    } finally {
      mutationPending.current = false;
      setIsCreating(false);
    }
  }

  async function closeRoom() {
    if (mutationPending.current || !roomToClose) return;
    const roomId = roomToClose.id;
    mutationPending.current = true;
    setClosingRoomId(roomId);
    setCloseError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      await check(response);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => current.filter((room) => room.id !== roomId));
      if (createdRoom?.id === roomId) setCreatedRoom(null);
      setRoomToClose(null);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : '关闭房间失败，请重试');
    } finally {
      mutationPending.current = false;
      setClosingRoomId(null);
    }
  }

  return <>
    <header className="live-heading">
      <div><h1>直播大厅<span className="live-heading-dot" /></h1><p>找个感兴趣的房间，让交流现在发生。</p></div>
      <div className="live-profile"><span className="live-avatar">{isLoggedIn ? hostNickname.slice(0, 1) : <LiveIcon name="users" />}</span><div><strong>{isLoggedIn ? hostNickname : '访客'}</strong><span>{isLoggedIn ? '主播账号' : '随时进入，参与聊天'}</span></div></div>
    </header>

    <section className="live-welcome" aria-label="直播广场">
      <div><h2>把日常，聊成现场。</h2><p>分享一个想法，听听不同的声音。你的下一场对话，从这里开始。</p></div>
      <div className="live-broadcast-art" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
      <div className="live-welcome-status"><LiveIcon name="video" size={18} /><span>{liveCount ? `${liveCount} 场直播正在进行` : '好话题，等你来开启'}</span></div>
    </section>
    <div className="live-lobby-layout">
      <section className="live-directory" aria-label="直播间列表">
        <div className="live-directory-top"><h2>发现直播 <span>{rooms.length}</span></h2><span className="live-update-note"><i />每 5 秒自动更新</span></div>
        <div className="live-directory-toolbar">
          <div className="live-filters" aria-label="筛选直播间">{(['全部', '直播中', '准备中'] as Filter[]).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}{value === '直播中' && <span>{liveCount}</span>}</button>)}</div>
          <div className="live-search-actions"><label className="live-search"><LiveIcon name="search" size={16} /><input type="search" aria-label="搜索直播间" placeholder="搜索直播间" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button type="button" className="live-icon-button" aria-label="刷新列表" title="刷新列表" disabled={roomsQuery.isFetching || isMutating} onClick={() => void roomsQuery.refetch()}><LiveIcon name="refresh" className={roomsQuery.isFetching ? 'live-spin' : undefined} /></button></div>
        </div>
        {roomsQuery.isError && <div role="alert" className="live-notice live-notice-error"><LiveIcon name="info" /><p>直播间列表更新失败，{roomsQuery.error.message}。请刷新列表重试。</p></div>}
        {roomsQuery.isPending ? <div role="status" className="live-empty"><LiveIcon name="refresh" size={28} className="live-spin" /><h3>正在加载直播间…</h3></div> : visibleRooms.length ? <div className="live-room-grid">
          {visibleRooms.map((room) => <article className="live-room-card" key={room.id} aria-label={room.title}>
            <Link href={`/live/${encodeURIComponent(room.id)}`} className={`live-room-cover ${room.status === '直播中' ? 'is-live' : ''}`} tabIndex={-1} aria-hidden="true">
              <span className={`live-status ${room.status === '直播中' ? 'is-on' : ''}`}><i />{room.status}</span>
              <div className="live-cover-symbol"><LiveIcon name={room.status === '直播中' ? 'play' : 'video'} size={30} /></div>
              <span className="live-cover-caption">{room.status === '直播中' ? '进入房间观看实时画面' : '即将开始 · 欢迎入座'}</span>
              <span className="live-cover-viewers"><LiveIcon name="users" size={13} />{room.viewers}</span>
            </Link>
            <div className="live-room-card-body"><h3 title={room.title}><Link href={`/live/${encodeURIComponent(room.id)}`}>{room.title}</Link></h3><p>{room.viewers} 人在房间</p>
              <div className="live-room-card-actions"><Link href={`/live/${encodeURIComponent(room.id)}`} className="live-enter-link">{isLoggedIn ? '进入直播间' : '观看'}<LiveIcon name="arrow" size={16} /></Link>{isLoggedIn && <button type="button" className="live-close-room" disabled={isMutating} aria-label={`关闭直播间：${room.title}`} onClick={() => { setCloseError(null); setRoomToClose(room); }}>关闭</button>}</div>
            </div>
          </article>)}
        </div> : !roomsQuery.isError && <div className="live-empty">
          <div className="live-empty-icon"><LiveIcon name={search ? 'search' : 'video'} size={30} /></div>
          <h3>{rooms.length ? '没有找到匹配的直播间' : '暂无直播间'}</h3>
          <p>{rooms.length ? '换个关键词，或看看其他状态的直播间。' : isLoggedIn ? '还没有人开播，创建一个直播间开始分享吧。' : '现在还没有人开播，过会儿再来看看。'}</p>
          {rooms.length > 0 && <button type="button" className="live-button live-button-secondary" onClick={() => { setSearch(''); setFilter('全部'); }}>查看全部直播间</button>}
        </div>}
        <p className="live-result-count" aria-live="polite">{!roomsQuery.isPending && `${visibleRooms.length} 个直播间${search || filter !== '全部' ? `，共 ${rooms.length} 个` : ''}`}</p>
      </section>

      <aside className="live-create-panel">
        <div className="live-create-icon"><LiveIcon name="video" size={24} /></div>
        <h2>创建直播间</h2><p>给房间起个名字，邀请大家来聊聊。</p>
        {isLoggedIn ? <form onSubmit={(event) => { event.preventDefault(); void createRoom(); }}>
          <label htmlFor="room-title">房间名称 <span>必填</span></label>
          <input id="room-title" aria-label="房间名称" required aria-invalid={!!error} aria-describedby={error ? "room-name-error" : "room-name-hint"} ref={titleRef} name="roomTitle" autoComplete="off" maxLength={100} disabled={isMutating} value={title} onChange={(event) => { setTitle(event.target.value); setError(null); }} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} placeholder="例如：下班后，聊点有趣的" className="live-input" />
          <p id="room-name-hint" className="live-name-hint">1–100 个字符，不能与已有房间重名</p>
          <button type="submit" disabled={isMutating} className="live-button live-button-primary live-create-button"><LiveIcon name="plus" size={17} />{isCreating ? '创建中…' : '创建直播间'}</button>
          <p className="live-create-hint">进入房间后，自行开启摄像头和麦克风。</p>
          {error && <p id="room-name-error" role="alert" className="live-form-error">{error}</p>}
          {createdRoom && <div className="live-created" role="status"><span><LiveIcon name="check" size={16} />直播间已创建</span><Link href={`/live/${encodeURIComponent(createdRoom.id)}`}>去准备直播<LiveIcon name="arrow" size={15} /></Link></div>}
        </form> : <><Link href="/login" className="live-button live-button-primary live-create-button">登录后创建<LiveIcon name="arrow" size={16} /></Link><p className="live-create-hint">观看直播和发送消息无需登录。</p></>}
        <div className="live-create-footer"><LiveIcon name="chat" size={17} /><p>进入直播间，就能和大家实时聊天。</p></div>
      </aside>
    </div>

    <dialog ref={dialogRef} className="live-dialog" aria-labelledby="close-room-title" aria-describedby="close-room-description" onCancel={(event) => { if (closingRoomId) event.preventDefault(); else setRoomToClose(null); }} onClose={() => setRoomToClose(null)}>
      <h2 id="close-room-title">关闭这个直播间？</h2><p id="close-room-description">关闭「{roomToClose?.title}」后，所有参与者将断开连接。之后可以创建新的直播间。</p>
      {closeError && <p role="alert" className="live-form-error">{closeError}</p>}
      <div className="live-dialog-actions"><button autoFocus type="button" className="live-button live-button-secondary" disabled={closingRoomId !== null} onClick={() => setRoomToClose(null)}>取消</button><button type="button" className="live-button live-button-danger" disabled={closingRoomId !== null} onClick={() => void closeRoom()}>{closingRoomId ? '关闭中…' : '确认关闭'}</button></div>
    </dialog>
  </>;
}
