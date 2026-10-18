'use client';

import type { ReactNode } from 'react';
import { AudioLines, Share2, Users } from 'lucide-react';
import { Sheet } from '@my-platform/web-ui/sheet';
import { SkeletonBlock } from '@my-platform/web-ui/skeleton';

export function MobileLiveRoomHeader({ back, title, pendingTitle = false, role, status, count, onShare }: {
  back: ReactNode; title: string; pendingTitle?: boolean; role: string | null; status: string;
  count: number | null; onShare?: () => void;
}) {
  return <header className="mb-4 flex min-w-0 items-center gap-3">
    {back}
    <div className="min-w-0 flex-1">
      <h1 data-room-title-pending={pendingTitle || undefined} className="flex h-7 items-center truncate text-lg font-semibold" title={pendingTitle ? undefined : title}>{pendingTitle ? <><span className="sr-only">直播间</span><span aria-hidden="true" className="h-4 w-28 max-w-full rounded bg-surface-soft" /></> : <span className="truncate">{title}</span>}</h1>
      <div className="mt-1 flex h-4 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-muted">{status ? <span role="status">{status}</span> : <SkeletonBlock className="h-2.5 w-20" />}{role && <span>{role}</span>}{count !== null && <span>{count} 人在房间</span>}</div>
    </div>
    <button type="button" disabled={!onShare} onClick={onShare} aria-label="分享直播间" className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-soft text-muted hover:bg-surface-hover hover:text-ink"><Share2 size={19} /></button>
  </header>;
}

export function MobileLiveRoomPanels({ selected, onSelect, participantCount, isHost, hasVoice, members, voice }: {
  selected: 'chat' | 'people' | 'voice'; onSelect: (value: 'chat' | 'people' | 'voice') => void;
  participantCount: number; isHost: boolean; hasVoice: boolean; members: ReactNode; voice: ReactNode;
}) {
  return <>
    <div className="order-first flex min-h-16 items-center justify-between gap-3 border-b border-line/60 px-4 py-2">
      <h2 className="text-base font-semibold">直播互动</h2>
      <div className="flex gap-2">
        <button type="button" aria-haspopup="dialog" aria-expanded={selected === 'people'} onClick={() => onSelect('people')} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-soft px-3 text-sm text-muted hover:bg-surface-hover hover:text-ink"><Users size={17} /><span>在线 {participantCount}</span></button>
        {isHost && <button type="button" aria-haspopup="dialog" aria-expanded={selected === 'voice'} onClick={() => onSelect('voice')} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-soft px-3 text-sm text-muted hover:bg-surface-hover hover:text-ink"><AudioLines size={17} /><span>连麦{hasVoice ? ' 1' : ''}</span></button>}
      </div>
    </div>
    <Sheet open={selected === 'people'} onClose={() => onSelect('chat')} title="在线成员">{members}</Sheet>
    <Sheet open={isHost && selected === 'voice'} onClose={() => onSelect('chat')} title="连麦管理">{voice}</Sheet>
  </>;
}
