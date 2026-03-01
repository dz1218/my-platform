import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';

export default async function NovelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getAuthUserId();

  const novel = await prisma.novel.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      chapters: {
        orderBy: { orderIndex: 'asc' },
        select: { id: true, title: true, orderIndex: true, published: true },
      },
    },
  });

  if (!novel) notFound();

  const isAuthor = userId === novel.authorId;
  const visibleChapters = isAuthor
    ? novel.chapters
    : novel.chapters.filter((c) => c.published);

  return (
    <main className="mx-auto max-w-[820px] px-6 pb-16 pt-10">
      <div className="mb-7">
        <Link href="/novels" className="link-muted inline-flex items-center gap-1.5">
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
          小说
        </Link>
      </div>

      <div className="mb-8">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2.5">
              <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.5px] text-slate-100">
                {novel.title}
              </h1>
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
            <p className="text-[13px] text-slate-500">
              作者：{novel.author.name ?? '匿名'}
            </p>
          </div>

          {isAuthor && (
            <Link
              href={`/novels/${id}/edit`}
              className="btn-glass shrink-0"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              管理
            </Link>
          )}
        </div>

        {novel.description && (
          <p className="mt-4 text-sm leading-7 text-slate-400">{novel.description}</p>
        )}
      </div>

      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">
          章节目录
          <span className="ml-2 text-sm font-normal text-slate-500">
            ({visibleChapters.length} 章)
          </span>
        </h2>
      </div>

      {visibleChapters.length === 0 ? (
        <div className="glass-card-soft px-6 py-12 text-center">
          <p className="text-sm text-slate-500">
            {isAuthor ? '还没有章节，去管理页面添加第一章吧。' : '暂无已发布章节。'}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {visibleChapters.map((chapter) => (
            <Link
              key={chapter.id}
              href={`/novels/${id}/chapters/${chapter.id}`}
              className="block no-underline text-inherit"
            >
              <div className="glass-card-soft room-card flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-600">
                    {String(chapter.orderIndex).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-medium text-slate-200">
                    {chapter.title}
                  </span>
                  {isAuthor && !chapter.published && (
                    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      草稿
                    </span>
                  )}
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-slate-600"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
