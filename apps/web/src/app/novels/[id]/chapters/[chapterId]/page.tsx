import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';

export default async function ChapterReadPage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  const userId = await getAuthUserId();

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { novel: { select: { id: true, title: true, authorId: true } } },
  });

  if (!chapter || chapter.novel.id !== id) notFound();

  const isAuthor = userId === chapter.novel.authorId;
  if (!chapter.published && !isAuthor) notFound();

  // Get prev/next chapters for navigation
  const [prevChapter, nextChapter] = await Promise.all([
    prisma.chapter.findFirst({
      where: {
        novelId: id,
        orderIndex: { lt: chapter.orderIndex },
        ...(isAuthor ? {} : { published: true }),
      },
      orderBy: { orderIndex: 'desc' },
      select: { id: true, title: true },
    }),
    prisma.chapter.findFirst({
      where: {
        novelId: id,
        orderIndex: { gt: chapter.orderIndex },
        ...(isAuthor ? {} : { published: true }),
      },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, title: true },
    }),
  ]);

  // Split content into paragraphs
  const paragraphs = chapter.content
    .split('\n')
    .filter((line) => line.trim().length > 0);

  return (
    <main className="mx-auto max-w-[720px] px-6 pb-16 pt-10">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <Link
          href={`/novels/${id}`}
          className="link-muted inline-flex items-center gap-1.5"
        >
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
          {chapter.novel.title}
        </Link>

        {isAuthor && (
          <Link
            href={`/novels/${id}/chapters/${chapterId}/edit`}
            className="link-muted"
          >
            编辑此章
          </Link>
        )}
      </div>

      {/* Chapter title */}
      <div className="mb-10">
        <p className="mb-1.5 text-xs font-bold tracking-[0.08em] text-violet-400/70">
          第 {chapter.orderIndex} 章
        </p>
        <h1 className="text-2xl font-extrabold tracking-[-0.5px] text-slate-100">
          {chapter.title}
        </h1>
        {!chapter.published && (
          <span className="mt-2 inline-block rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
            草稿 · 仅作者可见
          </span>
        )}
      </div>

      {/* Content */}
      <article className="mb-14">
        {paragraphs.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            本章暂无内容。
          </p>
        ) : (
          <div className="space-y-5">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-[15px] leading-[1.9] text-slate-300"
                style={{ textIndent: '2em' }}
              >
                {p}
              </p>
            ))}
          </div>
        )}
      </article>

      {/* Prev / Next navigation */}
      <div className="flex items-stretch gap-3">
        {prevChapter ? (
          <Link
            href={`/novels/${id}/chapters/${prevChapter.id}`}
            className="glass-card-soft room-card flex flex-1 items-center gap-3 px-5 py-4 no-underline text-inherit"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-slate-500"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.08em] text-slate-600">
                上一章
              </p>
              <p className="truncate text-sm font-medium text-slate-300">
                {prevChapter.title}
              </p>
            </div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}

        {nextChapter ? (
          <Link
            href={`/novels/${id}/chapters/${nextChapter.id}`}
            className="glass-card-soft room-card flex flex-1 items-center justify-end gap-3 px-5 py-4 no-underline text-inherit"
          >
            <div className="min-w-0 text-right">
              <p className="text-[10px] font-bold tracking-[0.08em] text-slate-600">
                下一章
              </p>
              <p className="truncate text-sm font-medium text-slate-300">
                {nextChapter.title}
              </p>
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
              className="shrink-0 text-slate-500"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </main>
  );
}
