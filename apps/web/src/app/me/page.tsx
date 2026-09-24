import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/actions';
export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="mb-8 font-serif text-3xl">我的</h1><section className="glass-card p-7"><h2 className="text-xl">{user.name}</h2><p className="mt-2 text-sm text-slate-400">{user.email}</p><Link href="/privacy" className="mt-8 block text-sm text-rose-200">平台互动说明 →</Link><form action={logoutAction} className="mt-8"><button className="btn-glass">退出登录</button></form></section></main>;
}
