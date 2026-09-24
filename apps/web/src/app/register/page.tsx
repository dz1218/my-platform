import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { registerAction } from '@/lib/actions';

const ERROR_MSG: Record<string, string> = {
  unavailable: '暂时连接不上，请稍后再试',
  rate_limit: '操作太频繁，请稍后再试',
  invalid_request: '请检查邮箱、昵称、8–72 字节密码与互动说明勾选', 
  missing: '请填写邮箱和密码',
  mismatch: '两次输入的密码不一致',
  weak: '密码至少需要 8 位',
  exists: '该邮箱已被注册',
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAuthenticated()) redirect('/companion');

  const { error } = await searchParams;
  const errorMsg = error ? (ERROR_MSG[error] ?? '注册失败，请重试') : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-9 text-center">
          <div className="mb-4 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-gradient-to-br from-violet-500 to-brand-500 shadow-violet-glow">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M20 8v6M23 11h-6" />
            </svg>
          </div>
          <h1 className="mb-1.5 bg-gradient-to-br from-slate-100 to-violet-300 bg-clip-text text-[22px] font-extrabold text-transparent">
            注册账号
          </h1>
          <p className="m-0 text-[13px] text-slate-600">从一句你好，开始慢慢认识</p>
        </div>

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

          <form action={registerAction} className="grid gap-4">
            <label className="grid gap-[7px]">
              <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
                昵称 <span className="font-normal text-slate-600">（可选）</span>
              </span>
              <input
                name="name"
                type="text"
                placeholder="怎么称呼你"
                autoComplete="nickname"
                className="input-glass"
              />
            </label>

            <label className="grid gap-[7px]">
              <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">邮箱</span>
              <input
                name="email"
                type="email"
                placeholder="your@email.com"
                required
                autoComplete="email"
                className="input-glass"
              />
            </label>

            <label className="grid gap-[7px]">
              <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">密码</span>
              <input
                name="password"
                type="password"
                placeholder="至少 8 位"
                required
                autoComplete="new-password"
                className="input-glass"
              />
            </label>

            <label className="grid gap-[7px]">
              <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">确认密码</span>
              <input
                name="confirm"
                type="password"
                placeholder="再次输入密码"
                required
                autoComplete="new-password"
                className="input-glass"
              />
            </label>

            <label className="flex items-start gap-2 text-xs leading-6 text-slate-400">
              <input type="checkbox" name="consent" required className="mt-1.5" />
              <span>我已阅读<Link href="/privacy" className="text-brand-300">平台互动说明</Link>，了解平台中的 AI 身份可能由真实用户参与互动。</span>
            </label>
            <button type="submit" className="btn-violet mt-1 w-full py-3 text-[15px] font-bold">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M20 8v6M23 11h-6" />
              </svg>
              注册
            </button>
          </form>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4 text-center">
          <Link href="/login" className="link-muted">
            已有账号？登录
          </Link>
          <span className="text-[13px] text-slate-800">·</span>
          <Link href="/" className="link-muted">
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
