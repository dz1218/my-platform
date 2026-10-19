'use client';

import type { ReactNode, Ref } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createDomainStore } from '@my-platform/client-core';
import { useStoreInstance } from '@my-platform/client-core/react';
import { Sheet } from '@my-platform/web-ui/sheet';
import { ArrowUpRight, ChevronRight, Plus, Radio, Search } from 'lucide-react';
import type { LiveRoomSummary } from '@my-platform/shared';
import { SkeletonBlock, SkeletonRegion } from '@my-platform/web-ui/skeleton';

type Filter = '全部' | '直播中' | '准备中';
type RenderLink = (href: string, children: ReactNode, className: string) => ReactNode;
const fallbackLink: RenderLink = (href, children, className) => <a href={href} className={className}>{children}</a>;

type FinderState = {
  open: boolean; search: string; filter: Filter;
  begin: (search: string, filter: Filter) => void;
  close: () => void;
  editSearch: (search: string) => void;
  editFilter: (filter: Filter) => void;
};
const createFinderStore = () => createDomainStore<FinderState>()(set => ({
  open: false, search: '', filter: '全部',
  begin: (search, filter) => set({ open: true, search, filter }),
  close: () => set({ open: false }),
  editSearch: search => set({ search }), editFilter: filter => set({ filter }),
}));

export function MobileLiveLobbyFrame({ actions, children }: { actions: ReactNode; liveCount?: number; children: ReactNode }) {
  return <div data-mobile-page="live" className="flex min-h-[calc(100dvh-136px-env(safe-area-inset-bottom))] flex-col">
    {children}
    <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] mt-6 bg-canvas py-3 [&>a]:min-h-14 [&>a]:w-full [&>a]:rounded-full [&>button]:min-h-14 [&>button]:w-full [&>button]:rounded-full">{actions}</div>
  </div>;
}

function QuietRecord() {
  return <svg aria-hidden="true" viewBox="0 0 180 180" className="mb-8 size-40 text-line" fill="none">
    <circle cx="90" cy="90" r="84" stroke="currentColor" />
    <circle cx="90" cy="90" r="72" stroke="currentColor" />
    <circle cx="90" cy="90" r="60" stroke="currentColor" />
    <circle cx="90" cy="90" r="24" className="fill-surface-soft" />
    <path d="M82 85v10m8-17v24m8-17v10" className="stroke-muted" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

export function MobileLiveDirectory({ rooms, total, liveCount, waitingCount, search = '', filter = '全部', loading = false, refreshing = false, refreshDisabled = false, updatesLabel, error, isLoggedIn = false, isMutating = false, onSearch, onFilter, onRefresh, onCloseRoom, renderLink = fallbackLink }: {
  rooms: LiveRoomSummary[]; total?: number; liveCount?: number; waitingCount?: number; search?: string; filter?: Filter;
  loading?: boolean; refreshing?: boolean; refreshDisabled?: boolean; updatesLabel?: string; error?: string;
  isLoggedIn?: boolean; isMutating?: boolean; onSearch?: (value: string) => void; onFilter?: (value: Filter) => void;
  onRefresh?: () => void; onCloseRoom?: (room: LiveRoomSummary) => void; renderLink?: RenderLink;
}) {
  const store = useStoreInstance(createFinderStore);
  const finder = useStore(store, useShallow(state => ({ open: state.open, search: state.search, filter: state.filter })));
  const { begin, close, editSearch, editFilter } = store.getState();
  const filtered = !!search || filter !== '全部';
  return <section aria-label="直播间列表" className="flex flex-1 flex-col">
    <header className="mb-5 flex min-h-12 items-center gap-2">
      <h1 className="mr-auto text-xl font-medium">直播</h1>
      {(!!total || filtered) && <button type="button" aria-label="查找直播间" aria-haspopup="dialog" onClick={() => begin(search, filter)} className="grid size-11 place-items-center rounded-full text-ink hover:bg-surface-soft"><Search className="size-5" /></button>}
    </header>
    {updatesLabel && <p className="sr-only" role="status">{updatesLabel}</p>}
    {filtered && <button type="button" onClick={() => begin(search, filter)} className="mb-4 flex min-h-11 items-center justify-between rounded-full bg-panel px-4 text-sm text-muted"><span className="truncate">{[search, filter !== '全部' && filter].filter(Boolean).join(' · ')}</span><span className="ml-3 shrink-0">修改</span></button>}
    {error && <div role="alert" className="my-4 rounded-panel bg-danger-soft p-5 text-sm leading-6 text-danger">直播间更新失败，{error}。<button type="button" disabled={!onRefresh || refreshing || refreshDisabled} onClick={onRefresh} className="mt-3 block min-h-11 font-medium">{refreshing ? '正在加载…' : '重新加载'}</button></div>}
    {loading ? <MobileLiveDirectorySkeleton /> : rooms.length ? <>
      <div className="mb-6 flex items-end justify-between"><p className="font-literary text-3xl leading-tight">听见，此刻。</p><span className="text-xs text-muted">{rooms.length} 个房间</span></div>
      <div className="grid gap-4">{rooms.map((room, index) => <article key={room.id} aria-label={room.title} data-browse-anchor={`room:${room.id}`} className={index === 0 ? 'rounded-scene bg-panel p-6' : 'border-b border-line/50 px-1 py-5'}>
        {renderLink(`/live/${encodeURIComponent(room.id)}`, <>
          <span className="flex items-center gap-2 text-xs text-muted"><Radio aria-hidden="true" className="size-4" />{room.status}<span className="ml-auto">{room.viewers} 人</span></span>
          <h2 className={`${index === 0 ? 'my-10 text-[28px]' : 'my-5 text-xl'} break-words font-literary leading-relaxed text-ink`}>{room.title}</h2>
          <span className="flex min-h-11 items-center justify-between text-sm text-ink"><span>{isLoggedIn && room.canManage ? '进入直播间' : '进入听听'}</span><ChevronRight aria-hidden="true" className="size-5" /></span>
        </>, 'block rounded-control focus-visible:outline-2 focus-visible:outline-focus')}
        {isLoggedIn && room.canManage && <button type="button" disabled={isMutating} aria-label={`关闭直播间：${room.title}`} onClick={() => onCloseRoom?.(room)} className="mt-2 min-h-11 w-full rounded-full bg-surface-soft text-sm text-muted disabled:opacity-50">关闭直播间</button>}
      </article>)}</div>
    </> : !error && <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <QuietRecord />
      <h2 className="font-literary text-[28px] leading-relaxed">{filtered ? '还没找到这个声音' : '今晚，还很安静。'}</h2>
      <p className="mt-3 text-sm leading-7 text-muted">{filtered ? '换个关键词，再找找。' : '暂无直播间，等一个声音，也可以是你。'}</p>
      {filtered && <button type="button" className="btn-secondary mt-6 rounded-full" onClick={() => { onSearch?.(''); onFilter?.('全部'); }}>查看全部直播间</button>}
    </div>}
    <Sheet open={finder.open} onClose={close} title="查找直播间">
      <form onSubmit={event => { event.preventDefault(); onSearch?.(finder.search.trim()); onFilter?.(finder.filter); close(); }} className="space-y-6">
        <label className="grid gap-3 text-sm text-muted">房间名称<input aria-label="搜索直播间" type="search" placeholder="想听什么？" value={finder.search} onChange={event => editSearch(event.target.value)} className="input-field" /></label>
        <fieldset><legend className="mb-3 text-sm text-muted">房间状态</legend><div className="grid grid-cols-3 gap-2">{(['全部', '直播中', '准备中'] as const).map(value => <button key={value} type="button" aria-pressed={finder.filter === value} onClick={() => editFilter(value)} className={`min-h-12 rounded-full text-sm ${finder.filter === value ? 'bg-action text-on-action' : 'bg-surface-soft text-muted'}`}>{value}{value !== '全部' && <span className="ml-1 text-xs">{value === '直播中' ? liveCount ?? 0 : waitingCount ?? 0}</span>}</button>)}</div></fieldset>
        <div className="flex gap-3"><button type="button" className="btn-secondary flex-1 rounded-full" onClick={() => { editSearch(''); editFilter('全部'); }}>重置</button><button type="submit" className="btn-primary flex-1 rounded-full">查看房间</button></div>
      </form>
    </Sheet>
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
  return <SkeletonRegion kind="rooms" label="正在加载直播间…" className="grid gap-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="rounded-scene bg-panel p-5"><SkeletonBlock className="h-4 w-20" /><SkeletonBlock className="my-6 h-8 w-4/5" /><div className="flex min-h-11 items-center"><SkeletonBlock className="h-4 w-16" /></div></div>)}</SkeletonRegion>;
}
