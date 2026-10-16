import { PageHeading } from '@/components/page-heading';
import { SceneBanner } from '@/components/scene-banner';
import { ListSkeleton } from '@/components/page-skeleton';

/** Static page content streams while the server retrieves the first room list. */
export function LiveLobbySkeleton() {
  return <div data-page-skeleton="live">
    <div className="hidden md:block">
      <PageHeading title="直播大厅" description="找个感兴趣的房间，让交流现在发生。" />
      <SceneBanner scene="live" title="把心事，调到同一个频率。" description="听一个声音，分享一段日常。总有故事正在发生。" />
    </div>
    <div className="md:hidden">
      <PageHeading title="直播" description="找一个声音，陪你度过此刻。" />
      <SceneBanner compact scene="live" title="此刻，有人同频。" description="好话题，等你来开启。" />
    </div>
    <ListSkeleton label="正在加载直播间…" />
  </div>;
}
