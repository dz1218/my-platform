import Link from 'next/link';
import { PageHeading } from '@/components/page-heading';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/actions';
export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <main id="main-content" tabIndex={-1} className="page-shell page-content">
    <PageHeading title="我的" description="管理你的账号，了解这里的互动方式。" />
    <section className="content-panel" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="panel-heading">个人资料</h2>
      <div className="flex items-center gap-4 px-5 py-6">
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-50 text-xl text-brand-600">{user.name?.slice(-1) || '我'}</span>
        <div className="min-w-0"><h3 className="break-words text-base font-semibold">{user.name}</h3><p className="mt-1 break-all text-sm text-slate-500">{user.email}</p></div>
      </div>
    </section>
    <section className="content-panel mt-5" aria-labelledby="account-heading">
      <h2 id="account-heading" className="panel-heading">账号与说明</h2>
      <Link href="/privacy" className="settings-row transition-colors hover:bg-slate-50"><div><h3 className="text-sm font-medium">平台互动说明</h3><p className="mt-1 text-xs leading-5 text-slate-500">了解 AI 身份、聊天记录与隐私</p></div><span aria-hidden="true" className="text-slate-400">›</span></Link>
      <div className="settings-row border-t border-slate-200"><p className="text-sm text-slate-600">退出当前账号</p><form action={logoutAction}><button className="btn-secondary">退出登录</button></form></div>
    </section>
  </main>;
}
