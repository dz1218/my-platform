import type { Metadata, Viewport } from "next";
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { sessionCookie } from '@/services/api/server';
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell, AppStartup } from "@/components/main-nav";
import { getCurrentUser } from "@/lib/auth";
export const metadata: Metadata = {
  title: { default: "Radio Friday · 陪伴", template: "%s · Radio Friday" },
  description: "聊天、阅读，留一点时间给自己。",
};
// Keep browser chrome aligned with --rf-canvas in theme.css.
export const viewport: Viewport = { themeColor: "#1B1B19", viewportFit: "cover" };
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // This local lookup avoids streaming an unnecessary bootstrap boundary for
  // guests, including auth documents before hydration or with JavaScript off.
  const hasSession = !!(await cookies()).get(sessionCookie)?.value;
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main-content" className="skip-link">
          跳到主要内容
        </a>
        {hasSession ? <Suspense fallback={<AppStartup />}>
          <AccountShell>{children}</AccountShell>
        </Suspense> : <Providers key="guest" initialUser={null}><AppShell>{children}</AppShell></Providers>}
      </body>
    </html>
  );
}

async function AccountShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return <Providers key={user?.id ?? 'guest'} initialUser={user}><AppShell>{children}</AppShell></Providers>;
}
