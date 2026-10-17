import Link from "next/link";
import { MobileReadingNavigation } from "@my-platform/mobile-web/reading";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
import { notFound } from "next/navigation";
import { getChapter } from "@/services/novels";
import { getAuthUserId } from "@/lib/auth";

export default async function ChapterReadPage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  const [userId, chapter] = await Promise.all([getAuthUserId(), getChapter(id, chapterId)]);

  if (!chapter || chapter.novel.id !== id) notFound();

  const isAuthor = userId === chapter.novel.authorId;
  if (!chapter.published && !isAuthor) notFound();

  const visibleChapters = isAuthor ? chapter.novel.chapters : chapter.novel.chapters.filter(item => item.published);
  const index = visibleChapters.findIndex(
    (item) => item.id === chapterId,
  );
  const prevChapter = visibleChapters[index - 1];
  const nextChapter = visibleChapters[index + 1];

  // Split content into paragraphs
  const paragraphs = chapter.content
    .split("\n")
    .filter((line) => line.trim().length > 0);

  return (
    <main id="main-content" tabIndex={-1} className="page-reading page-content min-h-dvh bg-reading pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-12">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between gap-4 md:mb-5">
        <Link
          href={`/novels/${id}`}
          className="link-muted inline-flex min-h-11 min-w-0 items-center gap-1.5"
        >
          <svg
            aria-hidden="true"
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
          <span className="truncate">{chapter.novel.title}</span>
        </Link>

        {isAuthor && (
          <Link
            href={`/novels/${id}/chapters/${chapterId}/edit`}
            className="link-muted shrink-0"
          >
            编辑此章
          </Link>
        )}
      </div>

      {/* Chapter title */}
      <div className="mb-10 pt-3 md:pt-0">
        <p className="mb-1.5 text-xs font-bold tracking-[0.08em] text-accent">
          第 {chapter.orderIndex} 章
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.5px] text-ink">
          {chapter.title}
        </h1>
        {!chapter.published && (
          <span className="mt-2 inline-block rounded-md border border-warning-line bg-warning-soft px-2 py-0.5 text-[10px] font-bold text-warning">
            草稿 · 仅作者可见
          </span>
        )}
      </div>

      {/* Content */}
      <article className="mb-14">
        {paragraphs.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            本章暂无内容。
          </p>
        ) : (
          <div className="space-y-5">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className="indent-[2em] text-lg leading-[1.9] text-ink"
              >
                {p}
              </p>
            ))}
          </div>
        )}
      </article>

      {/* Prev / Next navigation */}
      <div className="sticky bottom-0 hidden items-stretch md:flex gap-3 border-t border-line bg-reading py-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {prevChapter ? (
          <Link
            href={`/novels/${id}/chapters/${prevChapter.id}`}
            className="surface-soft room-card flex flex-1 items-center gap-3 px-5 py-4 no-underline text-inherit"
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-muted"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.08em] text-muted">
                上一章
              </p>
              <p className="truncate text-sm font-medium text-ink">
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
            className="surface-soft room-card flex flex-1 items-center justify-end gap-3 px-5 py-4 no-underline text-inherit"
          >
            <div className="min-w-0 text-right">
              <p className="text-[10px] font-bold tracking-[0.08em] text-muted">
                下一章
              </p>
              <p className="truncate text-sm font-medium text-ink">
                {nextChapter.title}
              </p>
            </div>
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-muted"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </div>
      <MobileReadingNavigation
        previous={prevChapter && <Link href={`/novels/${id}/chapters/${prevChapter.id}`}><ChevronLeft aria-hidden="true" className="size-4" />上一章</Link>}
        contents={<Link href={`/novels/${id}#chapters`}><List aria-hidden="true" className="size-4" />目录</Link>}
        next={nextChapter && <Link href={`/novels/${id}/chapters/${nextChapter.id}`}>下一章<ChevronRight aria-hidden="true" className="size-4" /></Link>}
      />
    </main>
  );
}
