import Link from 'next/link';
import type { Identity } from '@/types/companion';

export function IdentityModeSwitch({ identity, operator = false }: { identity: Identity; operator?: boolean }) {
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3">
    <p className="text-sm"><span className="text-muted">当前身份：</span><strong className="font-semibold">{operator ? `${identity.name}（AI 身份）` : '本账户'}</strong></p>
    <Link href={operator ? '/companion' : '/operator'} className="btn-secondary">{operator ? '切换到本账户' : `切换到${identity.name}`}</Link>
  </div>;
}
