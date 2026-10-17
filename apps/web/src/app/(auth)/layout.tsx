import Link from "next/link";
import { MobileAuthMasthead } from "@my-platform/mobile-web/auth";
import { RadioMark } from "@/components/radio-mark";
import { AuthStory } from "@/features/auth/auth-story";
import { AuthCloseButton } from "@/features/auth/auth-close-button";
import "@/features/auth/auth.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content" tabIndex={-1} className="auth-page">
    <div className="auth-ambient" aria-hidden="true" />
    <div className="auth-frame">
      <AuthCloseButton />
      <MobileAuthMasthead><Link href="/login" className="auth-brand"><RadioMark /><span>Radio Friday</span></Link></MobileAuthMasthead>
      <AuthStory />
      {children}
    </div>
    <p className="auth-page-caption">Radio Friday <span>你的日常，有人听见。</span></p>
  </main>;
}
