import type { ReactNode } from 'react';
import { PageHeading } from '@/components/page-heading';
import { SceneBanner } from '@/components/scene-banner';
import { CatalogSkeleton } from '@/features/catalog/catalog-skeleton';
import { ConversationSkeleton } from '@/features/chat/conversation-skeleton';
import { CatalogFiltersLoading } from '@/features/catalog/catalog-filters';
import { RecentConversationsLoading } from './recent-conversations-frame';

export function CompanionHeading({ mobile = false, actions }: { mobile?: boolean; actions?: ReactNode }) {
  return <PageHeading title={mobile ? '陪伴' : '今天想和谁聊聊？'} description="认识一位新朋友，或继续上次没聊完的话题。" actions={actions} />;
}

export function CompanionScene({ mobile = false }: { mobile?: boolean }) {
  return <SceneBanner scene="companion" compact={mobile} title={mobile ? '从一句问候开始。' : '窗外下着雨，心里有回音。'} description={mobile ? '按自己的节奏，认识一个愿意倾听的人。' : '从一句问候开始，多一个愿意倾听的朋友。'} />;
}

export function CompanionTabs({ tab, onSelect }: { tab: 'recent' | 'discover' | null; onSelect?: (tab: 'recent' | 'discover') => void }) {
  return <nav aria-label="陪伴内容" className="mb-6 flex gap-7 border-b border-line">
    {(['recent', 'discover'] as const).map(value => <button key={value} type="button" disabled={!onSelect} aria-pressed={tab === value} onClick={() => onSelect?.(value)} className={`min-h-12 border-b-2 px-1 pb-3 text-base ${tab === value ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted'}`}>{value === 'recent' ? '最近聊天' : '发现朋友'}</button>)}
  </nav>;
}

/** Only presentation mounts here; catalog requests and subscriptions wait for the account owner. */
export function CompanionLoadingContent({ tab = null }: { tab?: 'recent' | 'discover' | null }) {
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
      <CompanionHeading mobile />
      <CompanionTabs tab={tab} />
      {tab === 'discover' && <><CompanionScene mobile /><div className="section-heading min-h-11"><h2 className="text-base font-semibold">这里的朋友</h2></div><CatalogFiltersLoading mobile /></>}
      {tab === 'recent' ? <RecentConversationsLoading mobile /> : tab === 'discover' ? <CatalogSkeleton label="正在加载页面…" /> : <ConversationSkeleton label="正在加载页面…" />}
    </div>
  </>;
}

export function CompanionLoading({ tab }: { tab?: 'recent' | 'discover' | null }) {
  return <main id="main-content" tabIndex={-1} className="page-shell page-content"><CompanionLoadingContent tab={tab} /></main>;
}
