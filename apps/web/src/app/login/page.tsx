import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { loginAction } from "@/lib/actions";

const ERROR_MSG: Record<string, string> = {
  missing: "请填写邮箱和密码",
  invalid: "邮箱或密码不正确",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAuthenticated()) redirect("/live");

  const { error } = await searchParams;
  const errorMsg = error ? (ERROR_MSG[error] ?? "登录失败，请重试") : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-9 text-center">
          <div className="mb-4 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-gradient-to-br from-brand-500 to-violet-500 shadow-brand-glow">
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
              <path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0" />
              <circle cx="12" cy="20" r="1" fill="white" stroke="none" />
            </svg>
          </div>
          <h1 className="mb-1.5 bg-gradient-to-br from-slate-100 to-brand-300 bg-clip-text text-[22px] font-extrabold text-transparent">
            登录
          </h1>
          <p className="m-0 text-[13px] text-slate-600">登录后可创建直播间</p>
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

          <form action={loginAction} className="grid gap-4">
            <label className="grid gap-[7px]">
              <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
                邮箱
              </span>
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
              <span className="text-[13px] font-semibold tracking-[0.02em] text-slate-400">
                密码
              </span>
              <input
                name="password"
                type="password"
                placeholder="输入密码"
                required
                autoComplete="current-password"
                className="input-glass"
              />
            </label>

            <button
              type="submit"
              className="btn-indigo mt-1 w-full py-3 text-[15px] font-bold"
            >
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
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
              </svg>
              登录
            </button>
          </form>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4 text-center">
          <Link href="/register" className="link-muted">
            没有账号？注册
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
