'use client';

import type { ReactNode } from 'react';
import { AudioLines, ChevronUp, LogOut, MoreHorizontal, PhoneOff, RefreshCw, Settings2, Share2, Users } from 'lucide-react';
import { Sheet } from '@my-platform/web-ui/sheet';
import { useStore } from 'zustand';
import { createDomainStore } from '@my-platform/client-core';
import { useStoreInstance } from '@my-platform/client-core/react';
import { SkeletonBlock } from '@my-platform/web-ui/skeleton';

const createPanel = () => createDomainStore<{ open: boolean; show: () => void; close: () => void }>()(set => ({
  open: false, show: () => set({ open: true }), close: () => set({ open: false }),
}));

export function MobileLiveRoomHeader({ back, title, pendingTitle = false, role, status, count, onShare, onRefresh, refreshing = false }: {
  back: ReactNode; title: string; pendingTitle?: boolean; role: string | null; status: string;
  count: number | null; onShare?: () => void; onRefresh?: () => void; refreshing?: boolean;
}) {
  const store = useStoreInstance(createPanel);
  const open = useStore(store, state => state.open);
  const { show, close } = store.getState();
  return <header className="flex min-h-16 min-w-0 items-center gap-3 px-1 py-2">
    {back}
    <div className="min-w-0 flex-1">
      <h1 data-room-title-pending={pendingTitle || undefined} className="flex h-7 items-center truncate text-lg font-semibold" title={pendingTitle ? undefined : title}>{pendingTitle ? <><span className="sr-only">直播间</span><span aria-hidden="true" className="h-4 w-28 max-w-full rounded bg-surface-soft" /></> : <span className="truncate">{title}</span>}</h1>
      <div className="mt-1 flex h-4 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-muted">{status ? <span role="status">{status}</span> : <SkeletonBlock className="h-2.5 w-20" />}{role && <span>{role}</span>}</div>
    </div>
    <button type="button" onClick={show} aria-label="房间选项" aria-haspopup="dialog" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-soft"><MoreHorizontal aria-hidden="true" className="size-5" /></button>
    <Sheet open={open} onClose={close} title="房间选项">
      <p className="mb-5 break-words text-lg font-medium">{title}</p>
      <div className="grid gap-2">
        <button type="button" disabled={!onShare} onClick={() => { onShare?.(); close(); }} className="flex min-h-14 items-center gap-3 rounded-panel bg-surface-soft px-4 text-sm"><Share2 aria-hidden="true" className="size-5" />分享直播间</button>
        <button type="button" disabled={!onRefresh || refreshing} onClick={() => { onRefresh?.(); close(); }} className="flex min-h-14 items-center gap-3 rounded-panel bg-surface-soft px-4 text-sm"><RefreshCw aria-hidden="true" className="size-5" />{refreshing ? '刷新中…' : '刷新状态'}</button>
      </div>
    </Sheet>
  </header>;
}

export function MobileLiveRoomPanels({ selected, onSelect, participantCount, isHost, hasVoice, members, voice }: {
  selected: 'chat' | 'people' | 'voice'; onSelect: (value: 'chat' | 'people' | 'voice') => void;
  participantCount: number; isHost: boolean; hasVoice: boolean; members: ReactNode; voice: ReactNode;
}) {
  return <>
    <div className="order-first flex min-h-14 items-center justify-between gap-3 border-b border-line/60 px-4 py-2">
      <h2 className="text-base font-semibold">聊天</h2>
      <div className="flex gap-2">
        <button type="button" aria-haspopup="dialog" aria-expanded={selected === 'people'} onClick={() => onSelect('people')} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-soft px-3 text-sm text-muted hover:bg-surface-hover hover:text-ink"><Users size={17} /><span>在线 {participantCount}</span></button>
        {isHost && <button type="button" aria-haspopup="dialog" aria-expanded={selected === 'voice'} onClick={() => onSelect('voice')} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-soft px-3 text-sm text-muted hover:bg-surface-hover hover:text-ink"><AudioLines size={17} /><span>连麦{hasVoice ? ' 1' : ''}</span></button>}
      </div>
    </div>
    <Sheet open={selected === 'people'} onClose={() => onSelect('chat')} title="在线成员">{members}</Sheet>
    <Sheet open={isHost && selected === 'voice'} onClose={() => onSelect('chat')} title="连麦管理">{voice}</Sheet>
  </>;
}

/** Only presentation moves into a sheet. SDK resources remain in the room owner. */
export function MobileLiveControls({ host, joining, connected, callStatus, devices, leave, assistant, playback, sharing = false, error }: {
  host: boolean; joining: boolean; connected: boolean; callStatus?: 'pending' | 'approved' | null;
  devices: ReactNode; leave: ReactNode; assistant?: ReactNode; playback?: ReactNode; sharing?: boolean; error?: string | null;
}) {
  const store = useStoreInstance(createPanel);
  const open = useStore(store, state => state.open);
  const { show, close } = store.getState();
  return <div className="mobile-live-controls flex min-h-16 flex-wrap items-center gap-3 py-2">
    <button type="button" disabled={joining || !connected} onClick={show} aria-haspopup="dialog" aria-label={host ? '设备与助手' : '连麦与设备'} className={`flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm disabled:opacity-40 ${callStatus === 'approved' ? 'bg-action text-on-action' : 'bg-panel text-ink'}`}>
      {host ? <Settings2 aria-hidden="true" className="size-4" /> : <AudioLines aria-hidden="true" className="size-4" />}
      {joining ? '正在连接' : host ? sharing ? '设备 · 分享中' : '设备与助手' : callStatus === 'approved' ? '已获准 · 打开设备' : callStatus === 'pending' ? '等待同意 · 查看' : '连麦'}
    </button>
    <div className="shrink-0 [&>button]:min-h-12 [&>button]:rounded-full">{leave}</div>
    {playback && <div className="w-full [&>button]:min-h-11 [&>button]:w-full">{playback}</div>}
    <Sheet open={open} onClose={close} title={host ? '设备与助手' : '连麦与设备'} className="mobile-live-device-sheet">
      {error && <p role="alert" className="mb-5 rounded-panel bg-danger-soft p-4 text-sm leading-6 text-danger">{error}</p>}
      {!connected && <p role="status" className="mb-4 text-sm text-muted">连接恢复后可继续操作。</p>}
      {host ? <><p className="mb-5 text-sm text-muted">准备好后，再打开声音和画面。</p><div className="grid gap-3 [&>button]:min-h-14 [&>button]:w-full [&>button]:justify-start [&>button]:rounded-panel [&>button]:px-4">{devices}</div>{assistant && <div className="mt-6 border-t border-line pt-5 [&>button]:min-h-12 [&>button]:w-full">{assistant}</div>}</> : <><div className="grid gap-3 [&_button]:min-h-12 [&_button]:w-full [&_button]:justify-start [&_button]:px-4">{devices}</div><p className="mt-5 text-xs leading-6 text-muted">声音和画面由你开启，分享给直播间所有人。退出连麦后，仍可留在房间观看。</p></>}
    </Sheet>
  </div>;
}

export function MobileLiveLeave({ joining, host, disabled, onLeave, onEndCall, endCallDisabled = false }: {
  joining: boolean; host: boolean; disabled: boolean; onLeave: () => void;
  onEndCall?: () => void; endCallDisabled?: boolean;
}) {
  const store = useStoreInstance(createPanel);
  const open = useStore(store, state => state.open);
  const { show, close } = store.getState();
  return <>
    <button type="button" className="live-button live-button-leave" disabled={disabled} aria-haspopup={!joining && !host ? 'dialog' : undefined} aria-expanded={!joining && !host ? open : undefined} onClick={() => joining || host ? onLeave() : show()}>{joining ? '取消连接' : host ? '结束直播' : onEndCall ? '退出' : '离开'}{onEndCall && <ChevronUp aria-hidden="true" size={15} />}</button>
    <Sheet open={open} onClose={close} title={onEndCall ? '离开选项' : '离开直播间？'}>
      {onEndCall ? <div className="grid gap-2">
        <button type="button" aria-label="退出连麦" disabled={disabled || endCallDisabled} onClick={() => { close(); onEndCall(); }} className="flex min-h-18 items-center gap-3 rounded-control px-3 py-3 text-left hover:bg-surface-hover">
          <PhoneOff aria-hidden="true" size={20} className="shrink-0 text-muted" /><span><span className="block text-sm font-medium">退出连麦</span><span className="mt-1 block text-xs text-muted">留在直播间，继续观看</span></span>
        </button>
        <button type="button" aria-label="退出房间" disabled={disabled} onClick={() => { close(); onLeave(); }} className="flex min-h-18 items-center gap-3 rounded-control px-3 py-3 text-left hover:bg-danger-soft">
          <LogOut aria-hidden="true" size={20} className="shrink-0 text-danger" /><span><span className="block text-sm font-medium text-danger">退出房间</span><span className="mt-1 block text-xs text-muted">退出当前直播间</span></span>
        </button>
      </div> : <>
      <p className="mb-6 text-sm leading-7 text-muted">离开后关闭你的声音和画面，之后可以重新进入。</p>
      <div className="grid grid-cols-2 gap-3"><button type="button" className="btn-secondary" onClick={close}>继续观看</button><button type="button" className="btn-primary" onClick={() => { close(); onLeave(); }}>确认离开</button></div>
      </>}
    </Sheet>
  </>;
}
