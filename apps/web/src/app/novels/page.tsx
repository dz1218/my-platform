import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { isAuthenticated } from '@/lib/auth';

export default async function NovelListPage() {
  const [novels, loggedIn] = await Promise.all([
    prisma.novel.findMany({
      include: {
        author: { select: { name: true } },
        _count: { select: { chapters: { where: { published: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    isAuthenticated(),
  ]);

  return (
    <main className="mx-auto max-w-[820px] px-6 pb-16 pt-10">
      <div className="mb-7">
        <Link href="/" className="link-muted inline-flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          首页
        </Link>
      </div>

      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="icon-chip-violet h-[42px] w-[42px] rounded-xl">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#A78BFA"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
          </div>
          <div>
            <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.5px] text-slate-100">
              小说
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-500">
              精品内容，沉浸式阅读体验
            </p>
          </div>
        </div>

        {loggedIn && (
          <Link href="/novels/create" className="btn-violet px-5 py-2.5 text-sm">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            创建小说
          </Link>
        )}
      </div>

      {novels.length === 0 ? (
        <div className="glass-card-soft px-8 py-[72px] text-center">
          <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] border border-violet-400/25 bg-gradient-to-br from-violet-500/20 to-brand-500/10">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#A78BFA"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              <path d="M9 7h6M9 11h6M9 15h4" />
            </svg>
          </div>
          <p className="mb-2 text-[17px] font-bold text-slate-400">暂无小说</p>
          <p className="mx-auto max-w-80 text-sm leading-7 text-slate-600">
            {loggedIn ? '点击上方「创建小说」开始你的创作之旅。' : '还没有人发布小说，敬请期待。'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {novels.map((novel) => (
            <Link
              key={novel.id}
              href={`/novels/${novel.id}`}
              className="block no-underline text-inherit"
            >
              <div className="glass-card-soft room-card px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2.5">
                      <h2 className="m-0 truncate text-lg font-bold text-slate-100">
                        {novel.title}
                      </h2>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-[0.06em] ${
                          novel.status === 'completed'
                            ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                            : 'border border-violet-400/30 bg-violet-400/10 text-violet-300'
                        }`}
                      >
                        {novel.status === 'completed' ? '已完结' : '连载中'}
                      </span>
                    </div>
                    {novel.description && (
                      <p className="mb-3 line-clamp-2 text-sm leading-6 text-slate-400">
                        {novel.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>{novel.author.name ?? '匿名'}</span>
                      <span>·</span>
                      <span>{novel._count.chapters} 章</span>
                    </div>
                  </div>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-1.5 shrink-0 text-slate-600"
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
