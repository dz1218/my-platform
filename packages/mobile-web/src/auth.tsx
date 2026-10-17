import type { ReactNode } from 'react';

/** Only framing lives here. The host keeps one form, action, and verification ticket. */
export function MobileAuthHeading({ register, passwordStep }: { register: boolean; passwordStep: boolean }) {
  return <span className="auth-mobile-heading">{register ? passwordStep ? '认识一下你。' : '从一句你好开始。' : '欢迎回来。'}</span>;
}

export function MobileAuthMasthead({ children }: { children: ReactNode }) {
  return <header className="auth-brand-bar">{children}</header>;
}
