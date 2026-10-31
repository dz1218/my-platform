import { PasswordForm } from '@/features/auth/password-form';

export default function ForgotPasswordPage() {
  return <section className="auth-panel" aria-label="找回密码"><div className="auth-form-content"><PasswordForm mode="reset" /></div></section>;
}
