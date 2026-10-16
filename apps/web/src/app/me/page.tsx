import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AccountPhone } from '@/components/account-phone';
import { ProfileContent } from '@/features/account/profile-content';
import { getCurrentUser } from '@/lib/auth';
import '@/features/account/profile.css';

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <main id="main-content" tabIndex={-1} className="pb-12">
      <header className="relative isolate">
        <div aria-hidden="true" className="profile-cover-media pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden opacity-80 md:h-80">
          <Image src="/images/radio-friday/profile-moonlit-sea.png" alt="" fill priority sizes="(max-width: 767px) 100vw, calc(100vw - 236px)" className="object-cover object-top" />
        </div>
        <div className="page-shell relative flex min-h-80 flex-wrap items-end gap-5 pb-8 pt-40 sm:gap-6">
          <span aria-hidden="true" className="grid size-20 shrink-0 place-items-center rounded-full border border-line bg-panel text-3xl text-ink sm:size-24 sm:text-4xl">{user.name?.slice(-1) || '我'}</span>
          <div className="min-w-0 flex-1 basis-36">
            <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{user.name || '本账户'}</h1>
            <AccountPhone phone={user.phone} />
            <p className="mt-1 text-xs leading-6 text-muted">{user.inheritedIdentity ? `AI 身份 · ${user.inheritedIdentity.name}` : '本账户'}</p>
          </div>
        </div>
      </header>
      <div className="page-shell">
        <ProfileContent accountId={user.id} identity={user.inheritedIdentity} />
      </div>
    </main>
  );
}
