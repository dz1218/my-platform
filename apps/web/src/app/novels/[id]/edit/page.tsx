import { UnsavedChanges } from '@/components/unsaved-changes';
import { ConfirmForm } from '@/components/confirm-form';
import { SubmitButton } from '@/components/submit-button';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getNovel } from '@/services/novels';
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

  const novel = await getNovel(id);

  if (!novel) notFound();
  if (novel.authorId !== userId) redirect(`/novels/${id}`);

  return (
    <main id="main-content" tabIndex={-1} className="page-list page-content">
      <div className="mb-5">
        <Link
          href={`/novels/${id}`}
          className="link-muted inline-flex items-center gap-1.5"
        >
          <svg aria-hidden="true"
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

      <h1 className="mb-6 text-2xl font-semibold tracking-[-0.5px] text-slate-900">
        管理小说
      </h1>

      {/* ── 编辑小说信息 ── */}
      <div className="surface mb-6 p-5">
        <h2 className="mb-5 text-base font-bold text-slate-800">基本信息</h2>
        <form action={updateNovelAction} className="grid gap-5">
          <UnsavedChanges />
          <input type="hidden" name="novelId" value={id} />

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-600">
              标题
            </span>
            <input
              name="title" maxLength={200}
              type="text"
              defaultValue={novel.title}
              required
              className="input-field"
            />
          </label>

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-600">
              简介
            </span>
            <textarea
              name="description" maxLength={5000}
              defaultValue={novel.description ?? ''}
              rows={3}
              className="input-field resize-none"
            />
          </label>

          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-600">
              状态
            </span>
            <select name="status" defaultValue={novel.status} className="input-field">
              <option value="ongoing">连载中</option>
              <option value="completed">已完结</option>
            </select>
          </label>

          <SubmitButton className="btn-primary mt-1 py-2.5 text-sm font-bold">
            保存修改
          </SubmitButton>
        </form>
      </div>

      {/* ── 章节管理 ── */}
      <div className="surface mb-6 p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">
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
            name="title" maxLength={200} aria-label="新章节标题" autoComplete="off"
            type="text"
            placeholder="新章节标题"
            required
            className="input-field min-w-0 flex-1"
          />
          <SubmitButton className="btn-secondary shrink-0">
            <svg aria-hidden="true"
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
          </SubmitButton>
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
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-500">
                    {String(chapter.orderIndex).padStart(2, '0')}
                  </span>
                  <span className="text-sm text-slate-800">{chapter.title}</span>
                  {chapter.published ? (
                    <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      已发布
                    </span>
                  ) : (
                    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
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
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-5">
        <h2 className="mb-3 text-base font-bold text-rose-700">危险区域</h2>
        <p className="mb-4 text-sm text-slate-500">
          删除后无法恢复，所有章节将一并删除。
        </p>
        <ConfirmForm action={deleteNovelAction} message="删除后无法恢复，确定删除吗？">
          <input type="hidden" name="novelId" value={id} />
          <SubmitButton className="btn-danger-ghost">
            <svg aria-hidden="true"
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
          </SubmitButton>
        </ConfirmForm>
      </div>
    </main>
  );
}
