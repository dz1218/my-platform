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
    <main className="mx-auto max-w-[620px] px-6 pb-16 pt-10">
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

      <h1 className="mb-8 text-[26px] font-extrabold tracking-[-0.5px] text-slate-100">
        创建小说
      </h1>

      <div className="glass-card p-7">
        {errorMsg && (
          <div className="mb-5 flex items-center gap-2 rounded-[10px] border border-rose-500/25 bg-rose-500/[0.12] px-3.5 py-2.5">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FCA5A5"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span className="text-[13px] text-rose-300">{errorMsg}</span>
          </div>
        )}

        <form action={createNovelAction} className="grid gap-5">
          <label className="grid gap-[7px]">
            <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
              标题 <span className="text-rose-400">*</span>
            </span>
            <input
              name="title"
              type="text"
              placeholder="输入小说标题"
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
              placeholder="简要介绍你的小说（可选）"
              rows={4}
              className="input-glass resize-none"
            />
          </label>

          <button type="submit" className="btn-violet mt-1 w-full py-3 text-[15px] font-bold">
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
            创建
          </button>
        </form>
      </div>
    </main>
  );
}
