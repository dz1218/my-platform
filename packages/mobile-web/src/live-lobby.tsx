'use client';

import type { ReactNode, Ref } from 'react';
import { ArrowUpRight, ChevronRight, Headphones, Plus, Radio, RefreshCw, Search, Users } from 'lucide-react';
import type { LiveRoomSummary } from '@my-platform/shared';
import { SkeletonBlock, SkeletonRegion } from '@my-platform/web-ui/skeleton';

type Filter = '全部' | '直播中' | '准备中';
type RenderLink = (href: string, children: ReactNode, className: string) => ReactNode;
const fallbackLink: RenderLink = (href, children, className) => <a href={href} className={className}>{children}</a>;

export function MobileLiveLobbyFrame({ actions, liveCount, children }: { actions: ReactNode; liveCount?: number; children: ReactNode }) {
  return <div data-mobile-page="live">
    <header className="mb-6 flex items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold tracking-tight">直播</h1><p className="pt-2 text-sm leading-6 text-muted">找一个声音，陪你度过此刻。</p></div><div className="shrink-0">{actions}</div></header>
    <div className="mb-5 flex items-center gap-2 text-sm text-muted"><Radio aria-hidden="true" className="size-4 text-accent" /><p>{liveCount === undefined ? '正在寻找直播间…' : liveCount > 0 ? `${liveCount} 场直播正在进行` : '好话题，等你来开启。'}</p></div>
    {children}
  </div>;
}

export function MobileLiveDirectory({ rooms, total, liveCount, search = '', filter = '全部', loading = false, refreshing = false, refreshDisabled = false, error, isLoggedIn = false, isMutating = false, onSearch, onFilter, onRefresh, onCloseRoom, renderLink = fallbackLink }: {
  rooms: LiveRoomSummary[]; total?: number; liveCount?: number; search?: string; filter?: Filter;
  loading?: boolean; refreshing?: boolean; refreshDisabled?: boolean; error?: string;
  isLoggedIn?: boolean; isMutating?: boolean; onSearch?: (value: string) => void; onFilter?: (value: Filter) => void;
  onRefresh?: () => void; onCloseRoom?: (room: LiveRoomSummary) => void; renderLink?: RenderLink;
}) {
  return <section aria-label="直播间列表">
    <div className="mb-3 flex gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-panel px-4"><Search aria-hidden="true" className="size-4 shrink-0 text-muted" /><input type="search" aria-label="搜索直播间" placeholder="搜索直播间" className="min-h-12 min-w-0 w-full bg-transparent text-base text-ink placeholder:text-muted" value={search} disabled={!onSearch} onChange={event => onSearch?.(event.target.value)} /></label><button type="button" className="grid size-12 shrink-0 place-items-center rounded-full border border-line text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50" aria-label="刷新列表" title="刷新列表" disabled={!onRefresh || refreshing || refreshDisabled} onClick={onRefresh}><RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} /></button></div>
    <div className="mb-3 flex gap-2" aria-label="筛选直播间">{(['全部', '直播中', '准备中'] as const).map(value => <button key={value} type="button" disabled={!onFilter} aria-pressed={value === filter} onClick={() => onFilter?.(value)} className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm ${value === filter ? 'bg-action font-medium text-on-action' : 'bg-surface-soft text-muted hover:text-ink'}`}>{value}{value === '直播中' && liveCount !== undefined && <span className="text-xs">{liveCount}</span>}</button>)}</div>
    {error && <div role="alert" className="my-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm leading-6 text-danger">直播间列表更新失败，{error}。请刷新列表重试。</div>}
    {loading ? <MobileLiveDirectorySkeleton /> : rooms.length > 0 ? <div className="divide-y divide-line">{rooms.map(room => <article key={room.id} aria-label={room.title} data-browse-anchor={`room:${room.id}`} className="py-5">
      <div className="flex gap-3"><div aria-hidden="true" className={`grid size-14 shrink-0 place-items-center rounded-panel ${room.status === '直播中' ? 'bg-accent-soft text-accent' : 'bg-surface-soft text-muted'}`}>{room.status === '直播中' ? <Radio className="size-6" /> : <Headphones className="size-6" />}</div><div className="min-w-0 flex-1"><div className="mb-1.5 flex items-center gap-2 text-xs text-muted"><span className={room.status === '直播中' ? 'text-accent' : ''}>{room.status}</span><span className="ml-auto inline-flex items-center gap-1"><Users aria-hidden="true" className="size-3.5" />{room.viewers} 人</span></div><h2 className="break-words text-base font-semibold leading-6">{renderLink(`/live/${encodeURIComponent(room.id)}`, room.title, 'rounded-control hover:text-accent')}</h2></div></div>
      <div className="mt-3 flex items-center justify-end gap-3">{isLoggedIn && room.canManage && <button type="button" disabled={isMutating} aria-label={`关闭直播间：${room.title}`} className="min-h-11 rounded-control px-3 text-sm text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50" onClick={() => onCloseRoom?.(room)}>关闭</button>}{renderLink(`/live/${encodeURIComponent(room.id)}`, <>{isLoggedIn && room.canManage ? '进入直播间' : '观看'}<ChevronRight aria-hidden="true" className="size-4" /></>, 'inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-soft px-4 text-sm font-medium text-accent hover:bg-surface-hover')}</div>
    </article>)}</div> : !error && <div className="py-12"><Headphones aria-hidden="true" className="mb-5 size-9 text-accent" /><h2 className="text-lg font-semibold">{total ? '没有找到匹配的直播间' : '暂无直播间'}</h2><p className="pt-3 text-sm leading-7 text-muted">{total ? '换个关键词，或看看其他状态的直播间。' : isLoggedIn ? '还没有人开播，创建一个直播间开始分享吧。' : '现在还没有人开播，过会儿再来看看。'}</p>{!!total && <button type="button" className="btn-secondary mt-5" onClick={() => { onSearch?.(''); onFilter?.('全部'); }}>查看全部直播间</button>}</div>}
    {!loading && <p aria-live="polite" className="pt-4 text-xs text-muted">{rooms.length} 个直播间{search || filter !== '全部' ? `，共 ${total ?? 0} 个` : ''}</p>}
  </section>;
}

export function MobileCreateRoomPanel({ ownedRoom, ownedCount, createdRoomId, title, onTitle, inputRef, isLoggedIn, pending, failed, isMutating, isCreating, error, onCreate, renderLink }: {
  ownedRoom?: LiveRoomSummary; ownedCount: number; createdRoomId: string | null; title: string; onTitle: (value: string) => void;
  inputRef: Ref<HTMLInputElement>; isLoggedIn: boolean; pending: boolean; failed: boolean; isMutating: boolean; isCreating: boolean;
  error: string | null; onCreate: () => void; renderLink: RenderLink;
}) {
  return <div className="pb-2">
    {pending ? <SkeletonRegion kind="room-panel-heading" label="正在确认房间…"><SkeletonBlock className="h-5 w-2/3" /></SkeletonRegion> : <p className="text-sm leading-7 text-muted">{ownedRoom ? '每个账号同时只能保留一个直播间。' : '给房间起个名字，邀请大家来聊聊。'}</p>}
    {ownedRoom ? <><div role="status" className="my-5 rounded-panel bg-surface-soft p-4"><p className="text-xs text-accent">{createdRoomId === ownedRoom.id ? '直播间已创建' : '你已有直播间'}</p><p className="pt-2 break-words text-lg font-semibold">{ownedRoom.title}</p></div>{renderLink(`/live/${encodeURIComponent(ownedRoom.id)}`, <>进入我的直播间<ArrowUpRight aria-hidden="true" className="size-4" /></>, 'btn-primary w-full')}<p className="pt-4 text-xs leading-6 text-muted">{ownedCount > 1 ? `你已有 ${ownedCount} 个旧房间，请在列表中关闭多余房间。` : '关闭当前直播间后，才能创建新的房间。'}</p>{error && <p role="alert" className="pt-3 text-sm text-danger">{error}</p>}</> : isLoggedIn ? <form className="mt-5" onSubmit={event => { event.preventDefault(); onCreate(); }}>
      <label htmlFor="mobile-room-title" className="text-sm font-medium">房间名称 <span className="ml-2 text-xs font-normal text-muted">必填</span></label>
      <input id="mobile-room-title" ref={inputRef} aria-label="房间名称" required aria-invalid={!!error} aria-describedby={error ? 'mobile-room-error' : 'mobile-room-hint'} value={title} disabled={isMutating || pending || failed} onChange={event => onTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} name="roomTitle" autoComplete="off" maxLength={100} placeholder="例如：下班后，聊点有趣的" className="input-field mt-2" />
      <p id="mobile-room-hint" className="pt-2 text-xs leading-6 text-muted">1–100 个字符，不能与已有房间重名</p>
      {error && <p id="mobile-room-error" role="alert" className="pt-3 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={isMutating || pending || failed} className="btn-primary mt-6 w-full"><Plus aria-hidden="true" className="size-4" />{isCreating ? '创建中…' : pending ? '正在确认房间…' : '创建直播间'}</button><p className="pt-3 text-xs leading-6 text-muted">进入房间后，自行开启摄像头和麦克风。</p>
    </form> : <div className="mt-5">{renderLink('/login', '登录后创建', 'btn-primary w-full')}<p className="pt-3 text-xs leading-6 text-muted">观看直播和发送消息无需登录。</p></div>}
  </div>;
}

export function MobileLiveDirectorySkeleton() {
  return <SkeletonRegion kind="rooms" label="正在加载直播间…" className="divide-y divide-line">{Array.from({ length: 4 }, (_, index) => <div key={index} className="py-5"><div className="flex gap-3"><SkeletonBlock className="size-14 shrink-0 rounded-panel" /><div className="flex-1"><SkeletonBlock className="h-3 w-1/2" /><SkeletonBlock className="mt-3 h-5 w-4/5" /></div></div><SkeletonBlock className="mt-3 ml-auto h-11 w-24 rounded-full" /></div>)}</SkeletonRegion>;
}
