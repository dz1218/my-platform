import Link from 'next/link';
import { loginAction, registerAction } from '@/lib/actions';
import { SubmitButton } from '@/components/submit-button';
const errors: Record<string, string> = {
  unavailable: '暂时连接不上，请稍后再试。', rate_limit: '操作太频繁，请稍后再试。',
  invalid_request: '请检查邮箱、密码和互动说明勾选。密码需为 8–72 字节。',
  missing: '请填写邮箱和密码。', invalid: '邮箱或密码不正确，请重新输入。',
  mismatch: '两次输入的密码不一致。', weak: '密码至少需要 8 位。', exists: '该邮箱已被注册，请直接登录。',
};
export function AuthForm({ register = false, error }: { register?: boolean; error?: string }) {
  return <main id="main-content" tabIndex={-1} className="mx-auto grid min-h-dvh max-w-[800px] items-center gap-6 px-4 py-8 sm:px-6 md:grid-cols-2 md:gap-10">
    <div className="self-start pt-2 md:self-center"><Link href="/companion" className="text-xl font-semibold text-brand-600">今晚</Link><h1 className="mt-8 text-3xl font-semibold leading-snug md:mt-8 md:text-[32px]">{register ? '认识，从这里开始。' : '回来，接着聊。'}</h1><p className="mt-5 max-w-xs text-sm leading-7 text-slate-600">{register ? '留一点时间，听听彼此的日常。' : '聊聊天，读几页书。\n这里留着你上次的故事。'}</p></div>
    <section aria-labelledby="auth-heading" className="surface p-5 sm:p-6">
      <h2 id="auth-heading" className="mb-5 text-xl font-semibold">{register ? '创建账号' : '登录账号'}</h2>
      {error && <p role="alert" className="mb-5 rounded-lg bg-rose-50 p-3 text-sm leading-6 text-rose-800">{errors[error] ?? '操作失败，请重试。'}</p>}
      <form action={register ? registerAction : loginAction} className="grid gap-4">
        {register && <label className="grid gap-2 text-sm">昵称 <input name="name" autoComplete="nickname" placeholder="怎么称呼你（可选）" maxLength={40} className="input-field" /></label>}
        <label className="grid gap-2 text-sm">邮箱<input name="email" type="email" required autoComplete="email" spellCheck={false} placeholder="name@example.com" className="input-field" /></label>
        <label className="grid gap-2 text-sm">密码<input name="password" type="password" required minLength={register ? 8 : undefined} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '至少 8 位' : '输入密码'} className="input-field" /></label>
        {register && <><label className="grid gap-2 text-sm">确认密码<input name="confirm" type="password" required autoComplete="new-password" placeholder="再次输入密码" className="input-field" /></label><label className="flex items-start gap-3 text-xs leading-6 text-slate-600"><input type="checkbox" name="consent" required className="mt-1 h-4 w-4 shrink-0" /><span>我已阅读<Link href="/privacy" className="text-brand-600 underline underline-offset-4">平台互动说明</Link>，了解平台中的 AI 身份可能由真实用户参与互动。</span></label></>}
        <SubmitButton pendingLabel={register ? '正在注册…' : '正在登录…'} className="btn-primary mt-1 w-full">{register ? '注册' : '登录'}</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">{register ? '已有账号？' : '还没有账号？'}<Link href={register ? '/login' : '/register'} className="ml-1 text-brand-600 underline underline-offset-4">{register ? '登录' : '注册'}</Link></p>
    </section>
  </main>;
}
