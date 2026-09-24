import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { MainNav } from "@/components/main-nav";

export const metadata: Metadata = {
  title: "今晚 · 陪伴",
  description: "从一句你好开始，慢慢认识一个人。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="relative min-h-screen font-sans text-slate-100">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 bg-aurora"
        />
        <Providers><div className="relative z-10"><MainNav />{children}</div></Providers>
      </body>
    </html>
  );
}
