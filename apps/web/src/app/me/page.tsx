import Link from 'next/link';
import { MessageCircle, UserRound } from 'lucide-react';
import { InteractionNoticeTrigger } from '@/components/interaction-notice-dialog';
import { PageHeading } from '@/components/page-heading';
import { SubmitButton } from '@/components/submit-button';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/actions';
import { Avatar } from '@/features/identity/avatar';

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <div className="w-full">
        <PageHeading title="我的" description="管理本账户与 AI 身份，选择你想使用的聊天方式。" />
        <div className="grid grid-cols-1 items-start gap-6 md:gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-hidden rounded-panel bg-panel md:contents">
            <section aria-labelledby="profile-heading" className="md:col-span-full md:flex md:items-center md:justify-between md:gap-6 md:rounded-panel md:bg-panel md:p-8">
              <div className="md:flex md:min-w-0 md:flex-1 md:flex-col">
                <h2 id="profile-heading" className="px-6 pt-6 text-xs text-muted md:sr-only">本账户</h2>
                <div className="flex items-center gap-5 px-6 py-8 md:p-0">
                  <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-soft text-2xl text-accent">{user.name?.slice(-1) || '我'}</span>
                  <div className="min-w-0">
                    <p className="mb-1 hidden text-xs text-muted md:block">本账户</p>
                    <h3 className="wrap-break-word text-2xl font-semibold">{user.name}</h3>
                    <p className="mt-1 break-all text-sm text-muted">{user.phone || '尚未绑定手机号'}</p>
                  </div>
                </div>
              </div>
              <div className="border-t border-line px-5 py-4 md:shrink-0 md:border-0 md:p-0">
                <Link href="/companion" className="btn-secondary w-full md:w-auto md:gap-2"><MessageCircle aria-hidden="true" className="hidden size-4 md:block" />以本账户聊天</Link>
              </div>
            </section>
            <section aria-labelledby="identity-heading" className="mx-5 mb-5 rounded-panel border border-accent-line/60 bg-accent-soft/40 px-5 py-6 md:m-0 md:min-w-0 md:rounded-none md:border-0 md:bg-transparent md:p-0">
              <h2 id="identity-heading" className="text-sm font-semibold md:mb-4 md:text-base">我的 AI 身份</h2>
              <div className="md:rounded-panel md:border md:border-line md:bg-panel md:p-7">
                {user.inheritedIdentity ? <>
                  <div className="mt-4 flex items-center gap-3 md:mt-0"><Avatar identity={user.inheritedIdentity} /><p className="min-w-0 wrap-break-word font-medium md:text-xl">{user.inheritedIdentity.name}</p></div>
                  <p className="mt-3 text-xs leading-6 text-muted md:max-w-prose md:text-sm">以这个身份和其他真实用户聊天，设置 AI 托管与主动联系。</p>
                  <Link href="/operator" className="btn-primary mt-4 w-full whitespace-normal wrap-anywhere md:mt-6 md:w-auto">以{user.inheritedIdentity.name}的身份回复</Link>
                </> : <>
                  <div className="hidden items-center gap-3 md:flex"><span className="grid size-10 place-items-center rounded-control bg-surface-soft text-muted"><UserRound aria-hidden="true" className="size-5" /></span><h3 className="text-lg font-medium">还没有 AI 身份</h3></div>
                  <p className="mt-3 text-sm leading-6 text-muted md:hidden">你还没有继承 AI 身份。继承后，仍然可以用本账户与其他 AI 朋友聊天。</p>
                  <p className="mt-4 hidden max-w-prose text-sm leading-7 text-muted md:block">选择一个 AI 身份，以这个身份和其他真实用户聊天，也可以继续使用本账户。</p>
                  <Link href="/choose-identity" className="btn-secondary mt-4 w-full md:mt-6 md:w-auto md:border-action md:bg-action md:text-on-action md:hover:bg-action-hover">选择 AI 身份</Link>
                </>}
              </div>
            </section>
          </div>
          <section className="content-panel md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none" aria-labelledby="account-heading">
            <h2 id="account-heading" className="panel-heading md:mb-4 md:border-0 md:p-0 md:text-base">账号与说明</h2>
            <InteractionNoticeTrigger className="settings-row w-full text-left transition-colors hover:bg-surface-soft md:flex-nowrap md:gap-3 md:rounded-control md:px-3 md:py-5">
              <span className="min-w-0"><span className="block text-sm font-medium">平台互动说明</span><span className="mt-1 block text-xs leading-5 text-muted">了解 AI 身份、聊天记录与隐私</span></span>
            </InteractionNoticeTrigger>
            <div className="settings-row border-t border-line md:mt-2 md:block md:px-3 md:py-4">
              <p className="text-sm text-muted md:hidden">退出当前账号</p>
              <form action={logoutAction}>
                <SubmitButton pendingLabel="正在退出…" className="btn-secondary md:justify-start md:border-transparent md:bg-transparent md:px-0 md:text-muted md:enabled:hover:border-transparent md:enabled:hover:bg-transparent md:enabled:hover:text-ink">退出登录</SubmitButton>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
