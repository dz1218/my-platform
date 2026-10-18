import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { MobileLiveRoomHeader } from '@my-platform/mobile-web/live-room';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { LiveIcon } from './live-icon';
import '@/app/live/live.css';

/** Only the player waits here; metadata and chat resolve independently. */
export function LiveConnectionPending({ label = '正在连接直播间' }: { label?: string }) {
  return <div data-player-loading role="status" aria-label={label} aria-busy="true" className="pointer-events-none absolute inset-0 grid place-items-center">
    <LoaderCircle aria-hidden="true" className="size-6 text-muted motion-safe:animate-spin" strokeWidth={1.75} />
    <span className="sr-only">{label}</span>
  </div>;
}

export function LiveRoomTitle({ title }: { title?: string }) {
  return <h1 title={title} data-room-title-pending={!title || undefined}>{title ? <span className="truncate">{title}</span> : <><span className="sr-only">直播间</span><span aria-hidden="true" className="h-6 w-36 max-w-full rounded bg-surface-soft" /></>}</h1>;
}

export function LiveRoomControlsLoading() {
  return <SkeletonRegion kind="room-controls" label="正在加载房间操作" className="flex items-center gap-3"><SkeletonBlock className="h-4 w-20 bg-surface-hover" /><SkeletonBlock className="h-4 w-16 bg-surface-hover" /></SkeletonRegion>;
}

/** Empty message surface and a composer placeholder, never fabricated messages. */
export function LiveChatLoading() {
  return <div className="live-chat" data-skeleton="room-chat" role="status" aria-label="正在准备聊天" aria-busy="true">
    <span className="sr-only">正在准备聊天</span>
    <div className="live-chat-log" aria-hidden="true" />
    <div className="live-chat-form">
      <textarea aria-label="发送消息" disabled readOnly value="" rows={2} />
      <div className="live-chat-form-footer" aria-hidden="true"><SkeletonBlock className="h-2 w-24" /><div className="flex h-11 items-center"><SkeletonBlock className="h-7 w-14" /></div></div>
    </div>
  </div>;
}

export function LiveRoomLoading() {
  return <main id="main-content" tabIndex={-1} data-page-loading="room" className="live-page live-room-page">
    <div className="hidden md:block">
      <div className="live-room-nav"><Link href="/live" prefetch={false}><LiveIcon name="back" size={17} />直播大厅</Link><span>直播现场</span></div>
      <header className="live-room-heading">
        <div className="live-room-title"><LiveRoomTitle /><div className="live-room-meta"><SkeletonBlock className="h-3 w-24" /></div></div>
        <button type="button" disabled className="live-button live-button-secondary"><LiveIcon name="link" size={16} />分享直播间</button>
      </header>
    </div>
    <div className="md:hidden"><MobileLiveRoomHeader title="直播间" pendingTitle role={null} status="" count={null}
      back={<Link href="/live" prefetch={false} aria-label="返回直播大厅" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-soft"><LiveIcon name="back" size={21} /></Link>}
    /></div>
    <div className="mb-4 flex h-11 items-center justify-end"><SkeletonBlock className="h-3 w-32" /></div>
    <div className="live-studio">
      <div className="live-stage-column">
        <div className="live-stage" data-connecting>
          <div className="live-stage-top invisible" aria-hidden="true"><span><LiveIcon name="video" size={15} />直播画面</span></div>
          <LiveConnectionPending label="正在准备直播间" />
          <div className="live-stage-bottom invisible" aria-hidden="true"><span>直播画面</span><span className="size-9" /></div>
        </div>
        <div className="live-control-bar"><LiveRoomControlsLoading /><SkeletonBlock className="h-4 w-16 bg-surface-hover" /></div>
        <div className="live-studio-footer" aria-hidden="true"><SkeletonBlock className="h-3 w-48 max-w-full" /></div>
      </div>
      <aside className="live-sidebar" aria-label="直播互动">
        <div aria-hidden="true" className="flex min-h-16 shrink-0 items-center justify-between border-b border-line px-4 md:min-h-14"><SkeletonBlock className="h-3 w-12" /><SkeletonBlock className="h-3 w-16" /></div>
        <div className="live-chat-panel"><LiveChatLoading /></div>
      </aside>
    </div>
  </main>;
}
