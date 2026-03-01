import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthUserId } from '@/lib/auth';
import {
  updateNovelAction,
  deleteNovelAction,
  createChapterAction,
} from '@/lib/actions';

export default async function EditNovelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getAuthUserId();
  if (!userId) redirect('/login');

  const novel = await prisma.novel.findUnique({
    where: { id },
    include: {
      chapters: {
        orderBy: { orderIndex: 'asc' },
        select: { id: true, title: true, orderIndex: true, published: true },
      },
    },
  });

  if (!novel) notFound();
  if (novel.authorId !== userId) redirect(`/novels/${id}`);

  return (
    <main className="mx-auto max-w-[820px] px-6 pb-16 pt-10">
      <div className="mb-7">
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
          返回详情
        </Link>
      </div>

      <h1 className="mb-8 text-[26px] font-extrabold tracking-[-0.5px] text-slate-100">
        管理小说
      </h1>

      {/* ── 编辑小说信息 ── */}
      <div className="glass-card mb-8 p-7">
        <h2 className="mb-5 text-base font-bold text-slate-200">基本信息</h2>
        <form action={updateNovelAction} className="grid gap-5">
          <input type="hidden" name="novelId" value={id} />

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
              标题
            </span>
            <input
              name="title"
              type="text"
              defaultValue={novel.title}
              required
              className="input-glass"
            />
          </label>

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
              简介
            </span>
            <textarea
              name="description"
              defaultValue={novel.description ?? ''}
              rows={3}
              className="input-glass resize-none"
            />
          </label>

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
              状态
            </span>
            <select name="status" defaultValue={novel.status} className="input-glass">
              <option value="ongoing">连载中</option>
              <option value="completed">已完结</option>
            </select>
          </label>

          <button type="submit" className="btn-violet mt-1 py-2.5 text-sm font-bold">
            保存修改
          </button>
        </form>
      </div>

      {/* ── 章节管理 ── */}
      <div className="glass-card mb-8 p-7">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-200">
            章节管理
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({novel.chapters.length} 章)
            </span>
          </h2>
        </div>

        {/* 添加新章节 */}
        <form action={createChapterAction} className="mb-5 flex gap-3">
          <input type="hidden" name="novelId" value={id} />
          <input
            name="title"
            type="text"
            placeholder="新章节标题"
            required
            className="input-glass flex-1"
          />
          <button type="submit" className="btn-glass shrink-0">
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
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加章节
          </button>
        </form>

        {novel.chapters.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            还没有章节，在上方输入标题添加第一章。
          </p>
        ) : (
          <div className="grid gap-2">
            {novel.chapters.map((chapter) => (
              <div
                key={chapter.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-600">
                    {String(chapter.orderIndex).padStart(2, '0')}
                  </span>
                  <span className="text-sm text-slate-200">{chapter.title}</span>
                  {chapter.published ? (
                    <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      已发布
                    </span>
                  ) : (
                    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      草稿
                    </span>
                  )}
                </div>
                <Link
                  href={`/novels/${id}/chapters/${chapter.id}/edit`}
                  className="link-muted"
                >
                  编辑
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 危险区域 ── */}
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-7">
        <h2 className="mb-3 text-base font-bold text-rose-300">危险区域</h2>
        <p className="mb-4 text-sm text-slate-500">
          删除后无法恢复，所有章节将一并删除。
        </p>
        <form action={deleteNovelAction}>
          <input type="hidden" name="novelId" value={id} />
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
            删除小说
          </button>
        </form>
      </div>
    </main>
  );
}
