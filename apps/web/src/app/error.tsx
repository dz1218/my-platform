'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main-content" tabIndex={-1} className="page-shell page-content"><h1 className="page-title">暂时无法完成操作</h1><p role="alert" className="mt-4 text-slate-500">连接可能中断了。请稍后重试；填写中的内容请先保留。</p><div className="mt-8 flex gap-3"><button onClick={reset} className="btn-primary">重试</button><Link href="/companion" className="btn-secondary">返回陪伴</Link></div></main>;
}
