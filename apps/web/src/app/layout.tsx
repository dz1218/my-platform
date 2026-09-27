import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/main-nav';
export const metadata: Metadata = { title: { default: '今晚 · 陪伴', template: '%s · 今晚' }, description: '聊天、阅读，留一点时间给自己。' };
export const viewport: Viewport = { themeColor: '#F5F7F8' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><a href="#main-content" className="skip-link">跳到主要内容</a><Providers><AppShell>{children}</AppShell></Providers></body></html>;
}
