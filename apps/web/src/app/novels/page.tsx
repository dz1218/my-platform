import Link from 'next/link';

export default function NovelListPage() {
  return (
    <main className="mx-auto max-w-[820px] px-6 pb-16 pt-10">
      <div className="mb-7">
        <Link href="/" className="link-muted inline-flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          首页
        </Link>
      </div>

      <div className="mb-8 flex items-center gap-3.5">
        <div className="icon-chip-violet h-[42px] w-[42px] rounded-xl">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#A78BFA"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
        </div>
        <div>
          <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.5px] text-slate-100">小说</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">精品内容，沉浸式阅读体验</p>
        </div>
      </div>

      <div className="glass-card-soft px-8 py-[72px] text-center">
        <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] border border-violet-400/25 bg-gradient-to-br from-violet-500/20 to-brand-500/10">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#A78BFA"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            <path d="M9 7h6M9 11h6M9 15h4" />
          </svg>
        </div>

        <p className="mb-2 text-[17px] font-bold text-slate-400">暂无内容</p>
        <p className="mx-auto max-w-80 text-sm leading-7 text-slate-600">
          小说功能正在开发中，精彩内容敬请期待。
        </p>

        <div className="mt-7 inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-500/10 px-[18px] py-1.5 text-xs font-semibold tracking-[0.04em] text-violet-300">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          COMING SOON
        </div>
      </div>
    </main>
  );
}
