import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[760px] px-5 pb-16 pt-12">
      <h1 className="mt-0 text-3xl font-bold text-slate-100">页面不存在</h1>
      <p className="text-slate-500">你访问的页面没有找到。</p>
      <Link href="/" className="text-brand-300 no-underline hover:text-brand-400">
        返回首页
      </Link>
    </main>
  );
}
