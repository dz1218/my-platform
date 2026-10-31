import { CatalogFiltersLoading } from '@/features/catalog/catalog-filters';
import { RecentConversationsLoading } from './recent-conversations-frame';
import { MobileCompanionHeading, MobileCatalogSkeleton } from '@my-platform/mobile-web/companion';
import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';
import { DiscoveryToolbarLoading } from './discovery-toolbar';

// At 1440px: 1124px canvas = 832px directory + 32px gap + 260px rail.
export const companionDesktopLayout = 'grid items-start gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_260px]';
export const companionRecentRail = 'order-first min-w-0 min-[1100px]:sticky min-[1100px]:top-8 min-[1100px]:order-last';

export function CompanionHeading() {
  return <h1 className="sr-only">陪伴</h1>;
}

/** Only presentation mounts here; catalog requests and subscriptions wait for the account owner. */
export function CompanionLoadingContent() {
  return <>
    <div className="hidden md:block">
      <CompanionHeading />
      <div className={companionDesktopLayout}>
        <section className="min-w-0">
          <DiscoveryToolbarLoading />
          <CompanionCatalogSkeleton label="正在加载页面…" />
        </section>
        <aside aria-label="最近聊天" className={companionRecentRail}><RecentConversationsLoading /></aside>
      </div>
    </div>
    <div className="md:hidden">
      <MobileCompanionHeading />
      <h2 className="sr-only">这里的朋友</h2>
      <CatalogFiltersLoading mobile />
      <MobileCatalogSkeleton label="正在加载页面…" />
    </div>
  </>;
}

export function CompanionLoading() {
  return <main id="main-content" tabIndex={-1} className="page-shell page-content md:px-8 xl:px-10"><CompanionLoadingContent /></main>;
}

export function CompanionCatalogSkeleton({ label = '正在寻找可以认识的人…' }: { label?: string }) {
  return <SkeletonRegion kind="catalog" label={label} className="@container"><div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2 @min-[760px]:grid-cols-3 @min-[1040px]:grid-cols-4">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex h-64 min-w-0 flex-col rounded-panel border border-line/60 bg-panel p-5">
      <div className="flex items-center gap-3"><SkeletonBlock className="size-9 shrink-0 rounded-full" /><div className="flex-1"><SkeletonBlock className="h-5 w-20" /><SkeletonBlock className="mt-2 h-3 w-24" /></div></div>
      <SkeletonBlock className="mt-5 h-4 w-24" />
      <div className="mt-3 space-y-2"><SkeletonBlock className="h-4 w-full" /><SkeletonBlock className="h-4 w-full" /><SkeletonBlock className="h-4 w-2/3" /></div>
      <SkeletonBlock className="mt-auto h-4 w-20" />
    </div>)}
  </div></SkeletonRegion>;
}
