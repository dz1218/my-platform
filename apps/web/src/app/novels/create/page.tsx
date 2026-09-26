import { UnsavedChanges } from '@/components/unsaved-changes';
import { SubmitButton } from '@/components/submit-button';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { createNovelAction } from '@/lib/actions';

const ERROR_MSG: Record<string, string> = {
  missing: '请填写小说标题',
};

export default async function CreateNovelPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await isAuthenticated())) redirect('/login');

  const { error } = await searchParams;
  const errorMsg = error ? (ERROR_MSG[error] ?? '创建失败，请重试') : null;

  return (
    <main id="main-content" tabIndex={-1} className="page-form page-content">
      <div className="mb-5">
        <Link href="/novels" className="link-muted inline-flex items-center gap-1.5">
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
          小说
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-semibold tracking-[-0.5px] text-slate-900">
        创建小说
      </h1>

      <div className="surface p-5">
        {errorMsg && (
          <div className="mb-5 flex items-center gap-2 rounded-[10px] border border-rose-500/25 bg-rose-500/[0.12] px-3.5 py-2.5">
            <svg aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span className="text-[13px] text-rose-700">{errorMsg}</span>
          </div>
        )}

        <form action={createNovelAction} className="grid gap-5">
          <UnsavedChanges />
          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-600">
              标题 <span className="text-rose-700">*</span>
            </span>
            <input
              name="title" maxLength={200}
              type="text"
              placeholder="输入小说标题"
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
              placeholder="简要介绍你的小说（可选）"
              rows={4}
              className="input-field resize-none"
            />
          </label>

          <SubmitButton className="btn-primary mt-1 w-full py-3 text-[15px] font-bold">
            <svg aria-hidden="true"
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
            创建
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
