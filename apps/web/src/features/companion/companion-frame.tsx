import type { ReactNode } from 'react';
import { PageHeading } from '@/components/page-heading';
import { SceneBanner } from '@/components/scene-banner';
import { CatalogSkeleton } from '@/features/catalog/catalog-skeleton';
import { CatalogFiltersLoading } from '@/features/catalog/catalog-filters';
import { RecentConversationsLoading } from './recent-conversations-frame';
import { MobileCompanionHeading, MobileCatalogSkeleton } from '@my-platform/mobile-web/companion';

export function CompanionHeading({ actions }: { actions?: ReactNode } = {}) {
  return <PageHeading title="今天想和谁聊聊？" description="认识一位新朋友，或继续上次没聊完的话题。" actions={actions} />;
}

export function CompanionScene() {
  return <SceneBanner scene="companion" title="窗外下着雨，心里有回音。" description="从一句问候开始，多一个愿意倾听的朋友。" />;
}

/** Only presentation mounts here; catalog requests and subscriptions wait for the account owner. */
export function CompanionLoadingContent() {
  return <>
    <div className="hidden md:block">
      <CompanionHeading />
      <CompanionScene />
      <div className="companion-layout">
        <section className="min-w-0">
          <div className="section-heading min-h-11"><h2 className="text-base font-semibold">这里的朋友</h2><span className="text-xs font-normal text-muted">按自己的节奏来</span></div>
          <CatalogFiltersLoading />
          <CatalogSkeleton label="正在加载页面…" />
        </section>
        <aside aria-label="最近聊天" className="conversation-rail"><RecentConversationsLoading /></aside>
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
  return <main id="main-content" tabIndex={-1} className="page-shell page-content"><CompanionLoadingContent /></main>;
}
