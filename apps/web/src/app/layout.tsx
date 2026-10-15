import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/main-nav";
import { getCurrentUser } from "@/lib/auth";
export const metadata: Metadata = {
  title: { default: "Radio Friday · 陪伴", template: "%s · Radio Friday" },
  description: "聊天、阅读，留一点时间给自己。",
};
// Keep browser chrome aligned with --rf-canvas in theme.css.
export const viewport: Viewport = {
  themeColor: [
    { media: "(min-width: 768px)", color: "#181818" },
    { media: "(max-width: 767px)", color: "#F7F6F3" },
  ],
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main-content" className="skip-link">
          跳到主要内容
        </a>
        <Providers key={user?.id ?? "guest"}>
          <AppShell user={user}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
