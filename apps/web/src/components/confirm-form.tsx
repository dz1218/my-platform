'use client';
export function ConfirmForm({ action, message, children, className }: { action: (data: FormData) => void | Promise<void>; message: string; children: React.ReactNode; className?: string }) {
  return <form action={action} className={className} onSubmit={event => { if (!window.confirm(message)) event.preventDefault(); }}>{children}</form>;
}
