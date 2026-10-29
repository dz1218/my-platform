'use client';

import type { ReactNode } from 'react';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { LiveIcon } from './live-icon';
import '@/app/live/live.css';
import { MobileLiveLobbyFrame, MobileLiveDirectory } from '@my-platform/mobile-web/live-lobby';
export { MobileLiveLobbyFrame } from '@my-platform/mobile-web/live-lobby';

type LobbyFilter = '全部' | '直播中' | '准备中';

export function DesktopLiveLobbyFrame({ directory }: { directory: ReactNode }) {
  return <div className="flex min-h-[calc(100dvh-80px)] flex-col">
    <h1 className="sr-only">直播大厅</h1>

    {directory}
  </div>;
}

export function LiveDirectoryFrame({ count, liveCount, waitingCount, filter = '全部', search = '', onFilter, onSearch, updatesLabel = '正在连接实时更新…', children, result, action }: {
  count?: number;
  liveCount?: number;
  waitingCount?: number;
  filter?: LobbyFilter;
  search?: string;
  onFilter?: (filter: LobbyFilter) => void;
  onSearch?: (search: string) => void;
  updatesLabel?: string;
  children: ReactNode;
  result?: ReactNode;
  action?: ReactNode;
}) {
  return <section className="live-directory" aria-label="直播间列表">
    <div className="sr-only"><h2>直播间列表{count !== undefined && `，共 ${count} 个`}</h2><span role="status">{updatesLabel}</span></div>
    <div className="live-directory-toolbar">
      <div className="live-filters" aria-label="筛选直播间">{(['全部', '直播中', '准备中'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} disabled={!onFilter} onClick={() => onFilter?.(value)}>{value}{value !== '全部' && (value === '直播中' ? liveCount : waitingCount) !== undefined && <span>({value === '直播中' ? liveCount : waitingCount})</span>}</button>)}</div>
      <div className="live-search-actions"><label className="live-search"><LiveIcon name="search" size={16} /><input type="search" aria-label="搜索直播间" placeholder="搜索直播间" value={search} disabled={!onSearch} onChange={event => onSearch?.(event.target.value)} /></label>{action}</div>
    </div>
    {children}
    <p className="sr-only" aria-live="polite">{result}</p>
  </section>;
}

/** Responsive presentation only; account/query controllers mount after resolution. */
export function LiveLobbyLoadingContent() {
  const directory = <LiveDirectoryFrame action={<button type="button" className="live-lobby-start" disabled aria-label="正在确认房间…"><LiveIcon name="plus" size={16} />我要开播</button>}><LiveDirectorySkeleton /></LiveDirectoryFrame>;
  return <>
    <div className="hidden md:block">
      <DesktopLiveLobbyFrame directory={directory} />
    </div>
    <div className="flex flex-1 flex-col md:hidden">
      <MobileLiveLobbyFrame actions={<button type="button" className="btn-primary" disabled>我的直播间</button>}><MobileLiveDirectory rooms={[]} loading /></MobileLiveLobbyFrame>
    </div>
  </>;
}

export function LiveLobbyLoading() {
  return <main id="main-content" tabIndex={-1} className="page-shell live-page live-lobby-page"><LiveLobbyLoadingContent /></main>;
}

export function LiveDirectorySkeleton() {
  return <SkeletonRegion kind="rooms" label="正在加载直播间…" className="live-room-grid">
    {Array.from({ length: 4 }, (_, index) => <div key={index} className="min-w-0 overflow-hidden rounded-panel border border-line bg-panel">
      <SkeletonBlock className="aspect-video rounded-none" />
      <div className="live-room-card-body">
        <SkeletonBlock className="h-5 w-3/4" />
        <SkeletonBlock className="mt-2 h-4 w-1/3" />
        <div className="live-room-card-actions"><SkeletonBlock className="my-3 h-5 w-20" /></div>
      </div>
    </div>)}
  </SkeletonRegion>;
}
