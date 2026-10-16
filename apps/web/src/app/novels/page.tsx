export const dynamic = "force-dynamic";
import Link from "next/link";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/page-skeleton";
import { SceneBanner } from '@/components/scene-banner';
import { BookCover } from '@/features/novels/book-cover';
import { PageHeading } from "@/components/page-heading";
import { listNovels } from "@/services/novels";
import { isAuthenticated } from "@/lib/auth";

export default function NovelListPage() {
  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <PageHeading title="小说" description="找一本小说，慢慢读。" actions={<Suspense fallback={null}><CreateNovelAction /></Suspense>} />
    <SceneBanner scene="reading" title="翻开一页，走进另一种生活。" description="读几页书，让想象慢下来。下一段故事，从此刻开始。" />
    <Suspense fallback={<ListSkeleton books label="正在加载书架…" />}><NovelShelf /></Suspense>
  </main>;
}

async function CreateNovelAction() {
  return await isAuthenticated() ? <Link href="/novels/create" className="btn-primary">创建小说</Link> : null;
}

async function NovelShelf() {
  const [novels, loggedIn] = await Promise.all([
    listNovels().then(result => result.items), isAuthenticated(),
  ]);
  return <>
      <div className="section-heading">
        <h2>书架</h2>
        <span className="text-xs font-normal text-muted">
          {novels.length} 本小说
        </span>
      </div>

      {novels.length === 0 ? (
        <div className="empty-state">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[20px] border border-accent-line">
            <svg
              aria-hidden="true"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              <path d="M9 7h6M9 11h6M9 15h4" />
            </svg>
          </div>
          <p className="mb-2 text-[17px] font-bold text-muted">暂无小说</p>
          <p className="mx-auto max-w-80 text-sm leading-7 text-muted">
            {loggedIn
              ? "点击上方「创建小说」开始你的创作之旅。"
              : "还没有人发布小说，敬请期待。"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:gap-7">
          {novels.map(novel => <Link key={novel.id} href={`/novels/${novel.id}`} className="group min-w-0 rounded-panel outline-offset-4">
            <BookCover title={novel.title} author={novel.author.name ?? '匿名'} />
            <h2 className="mt-4 text-base leading-6 font-semibold group-hover:text-accent">{novel.title}</h2>
            <p className="mt-2 text-xs text-muted">{novel.chapterCount} 章 <span className="ml-2">{novel.status === 'completed' ? '已完结' : '连载中'}</span></p>
            {novel.description && <p className="mt-3 line-clamp-2 text-xs leading-6 text-muted">{novel.description}</p>}
          </Link>)}
        </div>
      )}
  </>;
}
