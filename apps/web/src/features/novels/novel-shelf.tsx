'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, RefreshCw } from 'lucide-react';
import { ListSkeleton } from '@/components/page-skeleton';
import { SceneBanner } from '@/components/scene-banner';
import { PageHeading } from '@/components/page-heading';
import { useCurrentAccount } from '@/features/account/use-current-account';
import { novelShelfQueryOptions } from '@/services/novel-shelf';
import { BookCover } from './book-cover';

export function NovelShelf() {
  const user = useCurrentAccount();
  const shelf = useQuery(novelShelfQueryOptions());
  const novels = shelf.data?.items;

  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <PageHeading title="小说" description="找一本小说，慢慢读。" actions={user && <Link href="/novels/create" className="btn-primary">创建小说</Link>} />
    <SceneBanner scene="reading" title="翻开一页，走进另一种生活。" description="读几页书，让想象慢下来。下一段故事，从此刻开始。" />
    <div className="section-heading">
      <h2>书架</h2>
      <div className="flex items-center gap-3">
        <span className="text-xs font-normal text-muted">{novels ? `${novels.length} 本小说` : ''}</span>
        <button type="button" aria-label="刷新小说" title="刷新小说" disabled={shelf.isFetching} onClick={() => void shelf.refetch()} className="grid size-11 place-items-center rounded-control text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50">
          <RefreshCw aria-hidden="true" className={`size-4 ${shelf.isFetching ? 'motion-safe:animate-spin' : ''}`} />
        </button>
      </div>
    </div>
    {shelf.isError && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger">
      <span>{novels ? '书架更新失败，已保留上次内容' : '书架暂时加载失败'}</span>
      <button type="button" disabled={shelf.isFetching} onClick={() => void shelf.refetch()} className="min-h-11 shrink-0 hover:text-danger-hover">重试</button>
    </div>}
    {shelf.isPending ? <ListSkeleton books label="正在加载书架…" /> : novels?.length === 0 ? <div className="empty-state">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[20px] border border-accent-line"><BookOpen aria-hidden="true" size={32} strokeWidth={1.5} /></div>
      <p className="mb-2 text-[17px] font-bold text-muted">暂无小说</p>
      <p className="mx-auto max-w-80 text-sm leading-7 text-muted">{user ? '点击上方「创建小说」开始你的创作之旅。' : '还没有人发布小说，敬请期待。'}</p>
    </div> : novels && <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:gap-7">
      {novels.map(novel => <Link key={novel.id} data-browse-anchor={`novel:${novel.id}`} href={`/novels/${novel.id}`} className="group min-w-0 rounded-panel outline-offset-4">
        <BookCover title={novel.title} author={novel.author.name ?? '匿名'} />
        <h2 className="mt-4 text-base leading-6 font-semibold group-hover:text-accent">{novel.title}</h2>
        <p className="mt-2 text-xs text-muted">{novel.chapterCount} 章 <span className="ml-2">{novel.status === 'completed' ? '已完结' : '连载中'}</span></p>
        {novel.description && <p className="mt-3 line-clamp-2 text-xs leading-6 text-muted">{novel.description}</p>}
      </Link>)}
    </div>}
  </main>;
}
