'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { MobileNovelSummary } from '@my-platform/mobile-web/novels';
import { MobilePullToRefresh } from '@my-platform/mobile-web/pull-to-refresh';
import { useViewport } from '@my-platform/web-ui/use-viewport';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen } from 'lucide-react';
import { useCurrentAccount } from '@/features/account/use-current-account';
import { NOVEL_PAGE_SIZE, novelShelfQueryOptions } from '@/services/novel-shelf';
import { useBrowseUI } from '@/stores/provider';
import type { Novel } from '@/services/novels';
import { BookCover } from './book-cover';
import { NovelShelfCreateAction, NovelShelfFrame, NovelShelfSkeleton, novelShelfGridClassName } from './novel-shelf-frame';
import { NovelShelfPagination, NovelShelfSearch } from './novel-shelf-controls';

export function NovelShelf() {
  const viewport = useViewport();
  const user = useCurrentAccount();
  const draft = useBrowseUI(s => s.novelSearchDraft);
  const search = useBrowseUI(s => s.novelSearch);
  const savedPage = useBrowseUI(s => s.novelPage);
  const setDraft = useBrowseUI(s => s.setNovelSearchDraft);
  const searchNovels = useBrowseUI(s => s.searchNovels);
  const setPage = useBrowseUI(s => s.setNovelPage);
  const client = useQueryClient();
  const results = useRef<HTMLDivElement>(null);
  const shelf = useQuery(novelShelfQueryOptions(savedPage, search));
  const novels = shelf.data?.items;
  const total = shelf.data?.total ?? novels?.length;
  const pageCount = total === undefined ? undefined : Math.max(1, Math.ceil(total / NOVEL_PAGE_SIZE));
  const page = shelf.data?.page ?? savedPage;

  useEffect(() => {
    if (!shelf.data || page === savedPage) return;
    // A deletion can move the last page backwards; reuse the server's corrected page.
    client.setQueryData(novelShelfQueryOptions(page, search).queryKey, shelf.data);
    setPage(page);
  }, [client, page, savedPage, search, setPage, shelf.data]);

  function changePage(next: number) {
    setPage(next);
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  return <NovelShelfFrame actions={user && <NovelShelfCreateAction />} count={total} search={<NovelShelfSearch draft={draft} onDraftChange={setDraft} onSearch={searchNovels} total={total} searching={!!search} busy={shelf.isFetching} />}>
    <MobilePullToRefresh enabled={viewport === 'mobile'} label="书架" busy={shelf.isFetching} onRefresh={() => shelf.refetch({ throwOnError: true, cancelRefetch: false })} />
    <div ref={results} id="novel-shelf-results" role="region" aria-label="小说列表" aria-busy={shelf.isFetching} tabIndex={-1} className="scroll-mt-6">
    {shelf.isError && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm text-danger">
      <span>{novels ? '书架更新失败，已保留上次内容' : '书架暂时加载失败'}</span>
      <button type="button" disabled={shelf.isFetching} onClick={() => void shelf.refetch()} className="min-h-11 shrink-0 hover:text-danger-hover">重试</button>
    </div>}
    {shelf.isPending ? <NovelShelfSkeleton /> : novels?.length === 0 && search ? <div className="rounded-panel bg-panel px-5 py-12 text-center">
      <p className="text-base font-medium text-ink">没有找到相关小说</p>
      <p className="mt-2 text-sm text-muted">换个关键词，或清空搜索查看全部小说。</p>
      <button type="button" onClick={() => searchNovels('')} className="btn-secondary mt-5">清空搜索</button>
    </div> : novels?.length === 0 ? viewport === 'mobile' ? <div className="empty-state">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[20px] border border-accent-line"><BookOpen aria-hidden="true" size={32} strokeWidth={1.5} /></div>
      <p className="mb-2 text-[17px] font-bold text-muted">暂无小说</p>
      <p className="mx-auto max-w-80 text-sm leading-7 text-muted">{user ? '点击上方「创建小说」开始你的创作之旅。' : '还没有人发布小说，敬请期待。'}</p>
    </div> : <div className="flex flex-col items-center rounded-panel bg-panel px-6 py-16 text-center">
      <BookOpen aria-hidden="true" className="mb-5 size-8 text-muted" strokeWidth={1.5} />
      <p className="text-base font-medium text-ink">暂无小说</p>
      <p className="mt-2 text-sm leading-6 text-muted">{user ? '从一个故事开始，创建你的第一本小说。' : '还没有人发布小说，敬请期待。'}</p>
      {user && <Link href="/novels/create" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-control px-4 text-sm text-ink transition-colors hover:bg-surface-soft">创建第一本小说<ArrowRight aria-hidden="true" className="size-4" /></Link>}
    </div> : novels && <div className={viewport === 'mobile' ? 'divide-y divide-line/60' : novelShelfGridClassName}>
      {novels.map(novel => <Link key={novel.id} data-browse-anchor={`novel:${novel.id}`} href={`/novels/${novel.id}`} className={viewport === 'mobile' ? 'group flex min-w-0 gap-4 py-5 outline-offset-4 first:pt-0' : 'group min-w-0 rounded-panel outline-offset-4'}>
          <NovelSummary novel={novel} mobile={viewport === 'mobile'} />
        </Link>)}
    </div>}
    </div>
    <NovelShelfPagination page={page} pageCount={pageCount} busy={shelf.isFetching} onPageChange={changePage} />
  </NovelShelfFrame>;
}

function NovelSummary({ novel, mobile }: { novel: Novel; mobile: boolean }) {
  if (mobile) return <MobileNovelSummary title={novel.title} author={novel.author.name ?? '匿名'} chapterCount={novel.chapterCount} completed={novel.status === 'completed'} description={novel.description} />;
  return <>
    <BookCover title={novel.title} author={novel.author.name ?? '匿名'} showBrand={false} />
    <h2 className="mt-4 text-base leading-6 font-semibold group-hover:text-accent">{novel.title}</h2>
    <p className="mt-2 text-xs text-muted">{novel.chapterCount} 章 <span className="ml-2">{novel.status === 'completed' ? '已完结' : '连载中'}</span></p>
    {novel.description && <p className="mt-3 line-clamp-2 text-xs leading-6 text-muted">{novel.description}</p>}
  </>;
}
