import type { Metadata } from "next";

// The single canonical origin; update SITE_URL when binding a new domain.
const configuredUrl = new URL(process.env.SITE_URL || "https://xingyun7.space");
if (!["http:", "https:"].includes(configuredUrl.protocol))
  throw new Error("SITE_URL must be an HTTP(S) URL");
export const siteUrl = new URL(configuredUrl.origin);
export const siteDescription =
  "Radio Friday 是中文陪伴空间：与 AI 角色聊天，在语音直播里相遇，或留一点时间阅读小说。";
export function publicMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: path,
      siteName: "Radio Friday",
      locale: "zh_CN",
      type: "website",
    },
    twitter: { card: "summary", title, description },
  };
}
