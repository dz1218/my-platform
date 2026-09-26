export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { PageHeading } from '@/components/page-heading';
import { listNovels } from '@/services/novels';
import { isAuthenticated } from '@/lib/auth';

export default async function NovelListPage() {
  const [novels, loggedIn] = await Promise.all([
    listNovels().then(result => result.items),
    isAuthenticated(),
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <PageHeading title="小说" description="找一本小说，慢慢读。" actions={loggedIn ? <Link href="/novels/create" className="btn-primary">创建小说</Link> : undefined} />
      <div className="section-heading"><h2>书架</h2><span className="text-xs font-normal text-slate-500">{novels.length} 本小说</span></div>

      {novels.length === 0 ? (
        <div className="empty-state">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[20px] border border-brand-300/25">
            <svg aria-hidden="true"
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
          <p className="mb-2 text-[17px] font-bold text-slate-600">暂无小说</p>
          <p className="mx-auto max-w-80 text-sm leading-7 text-slate-500">
            {loggedIn ? '点击上方「创建小说」开始你的创作之旅。' : '还没有人发布小说，敬请期待。'}
          </p>
        </div>
      ) : (
        <div className="content-panel divide-y divide-slate-200">
          {novels.map((novel) => (
            <Link
              key={novel.id}
              href={`/novels/${novel.id}`}
              className="block no-underline text-inherit"
            >
              <div className="room-card px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2.5">
                      <h2 className="m-0 truncate text-lg font-bold text-slate-900">
                        {novel.title}
                      </h2>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-[0.06em] ${
                          novel.status === 'completed'
                            ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-700'
                            : 'border border-brand-300/30 bg-brand-300/10 text-brand-700'
                        }`}
                      >
                        {novel.status === 'completed' ? '已完结' : '连载中'}
                      </span>
                    </div>
                    {novel.description && (
                      <p className="mb-3 line-clamp-2 text-sm leading-6 text-slate-600">
                        {novel.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>{novel.author.name ?? '匿名'}</span>
                      <span>·</span>
                      <span>{novel.chapterCount} 章</span>
                    </div>
                  </div>
                  <svg aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-1.5 shrink-0 text-slate-500"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
