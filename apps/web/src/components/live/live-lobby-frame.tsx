import type { ReactNode } from 'react';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { SceneBanner } from '@/components/scene-banner';
import { PageHeading } from '@/components/page-heading';
import { LiveIcon } from './live-icon';
import '@/app/live/live.css';

type LobbyFilter = '全部' | '直播中' | '准备中';

export function DesktopLiveLobbyFrame({ directory, roomPanel }: { directory: ReactNode; roomPanel: ReactNode }) {
  return <>
    <PageHeading title="直播大厅" description="找个感兴趣的房间，让交流现在发生。" />
    <SceneBanner scene="live" title="把心事，调到同一个频率。" description="听一个声音，分享一段日常。总有故事正在发生。" />
    <div className="live-lobby-layout">{directory}{roomPanel}</div>
  </>;
}

export function MobileLiveLobbyFrame({ actions, liveCount, children }: { actions: ReactNode; liveCount?: number; children: ReactNode }) {
  return <>
    <PageHeading title="直播" description="找一个声音，陪你度过此刻。" actions={actions} />
    <SceneBanner compact scene="live" title="此刻，有人同频。" description={liveCount ? `${liveCount} 场直播正在进行` : '好话题，等你来开启。'} />
    {children}
  </>;
}

export function LiveDirectoryFrame({ count, liveCount, filter = '全部', search = '', onFilter, onSearch, onRefresh, refreshing = false, refreshDisabled = false, children, result }: {
  count?: number;
  liveCount?: number;
  filter?: LobbyFilter;
  search?: string;
  onFilter?: (filter: LobbyFilter) => void;
  onSearch?: (search: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshDisabled?: boolean;
  children: ReactNode;
  result?: ReactNode;
}) {
  return <section className="live-directory" aria-label="直播间列表">
    <div className="live-directory-top"><h2>发现直播 {count !== undefined && <span>{count}</span>}</h2><span className="live-update-note"><i />每 5 秒自动更新</span></div>
    <div className="live-directory-toolbar">
      <div className="live-filters" aria-label="筛选直播间">{(['全部', '直播中', '准备中'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} disabled={!onFilter} onClick={() => onFilter?.(value)}>{value}{value === '直播中' && liveCount !== undefined && <span>{liveCount}</span>}</button>)}</div>
      <div className="live-search-actions"><label className="live-search"><LiveIcon name="search" size={16} /><input type="search" aria-label="搜索直播间" placeholder="搜索直播间" value={search} disabled={!onSearch} onChange={event => onSearch?.(event.target.value)} /></label><button type="button" className="live-icon-button" aria-label="刷新列表" title="刷新列表" disabled={!onRefresh || refreshing || refreshDisabled} onClick={onRefresh}><LiveIcon name="refresh" className={refreshing ? 'live-spin' : undefined} /></button></div>
    </div>
    {children}
    <p className="live-result-count" aria-live="polite">{result}</p>
  </section>;
}

export function LiveCreatePanelFrame({ title, description, pending = false, children }: { title: string; description: string; pending?: boolean; children: ReactNode }) {
  return <aside className="live-create-panel" aria-busy={pending || undefined}>
    <div className="live-create-icon"><LiveIcon name="video" size={24} /></div>
    {pending ? <SkeletonRegion kind="room-panel-heading" label="正在确认房间…">
      <div className="relative text-[22px] font-semibold tracking-[-.4px] max-[479px]:text-[17px]">
        <span className="invisible">{title}</span>
        <SkeletonBlock className="absolute inset-y-1 left-0 w-32 max-w-full" />
      </div>
      <div className="relative mt-2.5 text-[13px] leading-[1.9] max-[479px]:text-xs">
        <span className="invisible">{description}</span>
        <SkeletonBlock className="absolute top-[.45em] left-0 h-[1em] w-full max-w-60" />
      </div>
    </SkeletonRegion> : <><h2>{title}</h2><p>{description}</p></>}
    {children}
    <div className="live-create-footer"><LiveIcon name="chat" size={17} /><p>进入直播间，就能和大家实时聊天。</p></div>
  </aside>;
}

/** Responsive presentation only; account/query controllers mount after resolution. */
export function LiveLobbyLoadingContent() {
  const directory = <LiveDirectoryFrame><LiveDirectorySkeleton /></LiveDirectoryFrame>;
  return <>
    <div className="hidden md:block">
      <DesktopLiveLobbyFrame directory={directory} roomPanel={<LiveCreatePanelFrame pending title="创建直播间" description="给房间起个名字，邀请大家来聊聊。">
        <div className="mt-7">
          <label htmlFor="startup-room-title">房间名称 <span>必填</span></label>
          <input id="startup-room-title" className="live-input" placeholder="例如：下班后，聊点有趣的" disabled />
          <p className="live-name-hint">1–100 个字符，不能与已有房间重名</p>
          <button type="button" className="live-button live-button-primary live-create-button" disabled>正在确认房间…</button>
          <p className="live-create-hint">进入房间后，自行开启摄像头和麦克风。</p>
        </div>
      </LiveCreatePanelFrame>} />
    </div>
    <div className="md:hidden">
      <MobileLiveLobbyFrame actions={<button type="button" className="btn-primary" disabled>我的直播间</button>}>{directory}</MobileLiveLobbyFrame>
    </div>
  </>;
}

export function LiveLobbyLoading() {
  return <main id="main-content" tabIndex={-1} className="page-shell live-page"><LiveLobbyLoadingContent /></main>;
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
