import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Platform',
  description: 'Live + Novel + Future Agent platform',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="relative min-h-screen font-sans text-slate-100">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-aurora" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
