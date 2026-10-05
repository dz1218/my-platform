import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { Avatar } from '@/features/identity/avatar';
export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <PageHeading
        title="我的"
        description="管理本账户与 AI 身份，选择你想使用的聊天方式。"
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="content-panel" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="panel-heading">
          本账户
        </h2>
        <div className="flex items-center gap-4 px-5 py-6">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-50 text-xl text-brand-600"
          >
            {user.name?.slice(-1) || "我"}
          </span>
          <div className="min-w-0">
            <h3 className="wrap-break-word text-base font-semibold">
              {user.name}
            </h3>
            <p className="mt-1 break-all text-sm text-slate-500">
              {user.email}
            </p>
          </div>
        </div>
        <div className="border-t border-line px-5 py-4"><Link href="/companion" className="btn-secondary w-full">以本账户聊天</Link></div>
        <div className="border-t border-line px-5 py-5">
          <h2 className="text-sm font-semibold">我的 AI 身份</h2>
          {user.inheritedIdentity ? <>
            <div className="mt-4 flex items-center gap-3"><Avatar identity={user.inheritedIdentity} /><p className="font-medium">{user.inheritedIdentity.name}</p></div>
            <p className="mt-3 text-xs leading-6 text-muted">以这个身份和其他真实用户聊天，设置 AI 托管与主动联系。</p>
            <Link href="/operator" className="btn-primary mt-4 w-full">以{user.inheritedIdentity.name}的身份回复</Link>
          </> : <>
            <p className="mt-3 text-sm leading-6 text-muted">你还没有继承 AI 身份。继承后，仍然可以用本账户与其他 AI 朋友聊天。</p>
            <Link href="/choose-identity" className="btn-secondary mt-4 w-full">选择 AI 身份</Link>
          </>}
        </div>
      </section>
      <section className="content-panel" aria-labelledby="account-heading">
        <h2 id="account-heading" className="panel-heading">
          账号与说明
        </h2>
        <Link
          href="/privacy"
          className="settings-row transition-colors hover:bg-slate-50"
        >
          <div>
            <h3 className="text-sm font-medium">平台互动说明</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              了解 AI 身份、聊天记录与隐私
            </p>
          </div>
          <span aria-hidden="true" className="text-slate-400">
            ›
          </span>
        </Link>
        <div className="settings-row border-t border-slate-200">
          <p className="text-sm text-slate-600">退出当前账号</p>
          <form action={logoutAction}>
            <button className="btn-secondary">退出登录</button>
          </form>
        </div>
      </section>
      </div>
    </main>
  );
}
