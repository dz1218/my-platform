import Link from 'next/link';

export default async function NovelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto max-w-[820px] px-6 pb-12 pt-8">
      <div className="mb-6">
        <Link href="/novels" className="link-muted text-[13px]">
          ← 小说
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-slate-100">{id}</h1>

      <div className="glass-card-soft rounded-xl px-6 py-10 text-center text-sm text-slate-500">
        暂无内容，敬请期待。
      </div>
    </main>
  );
}
