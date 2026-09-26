'use client';
import { useFormStatus } from 'react-dom';
export function SubmitButton({ children, pendingLabel = '正在保存…', className = 'btn-primary' }: { children: React.ReactNode; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-live="polite" className={className}>{pending ? pendingLabel : children}</button>;
}
