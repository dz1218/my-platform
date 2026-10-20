import { publicMetadata } from "@/lib/seo";
export const metadata = publicMetadata(
  "平台互动说明",
  "了解 Radio Friday 的 AI 与真人回复、角色继承及历史聊天访问机制。",
  "/privacy",
);
import { InteractionNotice } from "@/components/interaction-notice";
import Link from "next/link";
export default function PrivacyPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-reading page-content">
      <h1 className="font-semibold text-2xl">平台互动说明</h1>
      <div className="mt-8 space-y-6 text-sm leading-8 text-ink">
        <InteractionNotice headingLevel="h2" />
      </div>
      <Link href="/companion" className="btn-secondary mt-10">
        返回陪伴
      </Link>
    </main>
  );
}
