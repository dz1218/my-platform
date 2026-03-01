import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';
import {
  updateChapterAction,
  publishChapterAction,
  deleteChapterAction,
} from '@/lib/actions';

export default async function EditChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; chapterId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id, chapterId } = await params;
  const { saved, error } = await searchParams;
  const userId = await getAuthUserId();
  if (!userId) redirect('/login');

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { novel: { select: { id: true, title: true, authorId: true } } },
  });

  if (!chapter || chapter.novel.id !== id) notFound();
  if (chapter.novel.authorId !== userId) redirect(`/novels/${id}`);

  return (
    <main className="mx-auto max-w-[820px] px-6 pb-16 pt-10">
      <div className="mb-7 flex items-center justify-between">
        <Link
          href={`/novels/${id}/edit`}
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
          章节管理
        </Link>

        <Link
          href={`/novels/${id}/chapters/${chapterId}`}
          className="link-muted"
        >
          预览
        </Link>
      </div>

      {saved && (
        <div className="mb-5 flex items-center gap-2 rounded-[10px] border border-emerald-500/25 bg-emerald-500/[0.12] px-3.5 py-2.5">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6EE7B7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span className="text-[13px] text-emerald-300">保存成功</span>
        </div>
      )}

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-[10px] border border-rose-500/25 bg-rose-500/[0.12] px-3.5 py-2.5">
          <span className="text-[13px] text-rose-300">请填写章节标题</span>
        </div>
      )}

      <h1 className="mb-1 text-[22px] font-extrabold tracking-[-0.5px] text-slate-100">
        编辑章节
      </h1>
      <p className="mb-8 text-[13px] text-slate-500">
        第 {chapter.orderIndex} 章 · {chapter.novel.title}
      </p>

      {/* Edit form */}
      <div className="glass-card mb-6 p-7">
        <form action={updateChapterAction} className="grid gap-5">
          <input type="hidden" name="chapterId" value={chapterId} />

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
              章节标题
            </span>
            <input
              name="title"
              type="text"
              defaultValue={chapter.title}
              required
              className="input-glass"
            />
          </label>

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
              内容
            </span>
            <textarea
              name="content"
              defaultValue={chapter.content}
              rows={20}
              placeholder="在这里写下你的故事..."
              className="input-glass resize-y font-mono text-sm leading-7"
            />
          </label>

          <button type="submit" className="btn-violet py-2.5 text-sm font-bold">
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
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            保存
          </button>
        </form>
      </div>

      {/* Publish / Unpublish */}
      <div className="flex items-center gap-3">
        <form action={publishChapterAction}>
          <input type="hidden" name="chapterId" value={chapterId} />
          <input
            type="hidden"
            name="published"
            value={chapter.published ? '0' : '1'}
          />
          <button
            type="submit"
            className={
              chapter.published ? 'btn-glass' : 'btn-emerald px-5 py-2.5 text-sm'
            }
          >
            {chapter.published ? (
              <>
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
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                取消发布
              </>
            ) : (
              <>
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
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
                发布此章
              </>
            )}
          </button>
        </form>

        <form action={deleteChapterAction}>
          <input type="hidden" name="chapterId" value={chapterId} />
          <button type="submit" className="btn-danger-ghost">
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
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            删除章节
          </button>
        </form>
      </div>
    </main>
  );
}
