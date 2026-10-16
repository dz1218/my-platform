'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function AccountPhone({ phone, onPhoto = false }: { phone?: string; onPhoto?: boolean }) {
  const [visible, setVisible] = useState(false);
  if (!phone) return <p className={`mt-1 text-sm ${onPhoto ? 'text-photo-muted' : 'text-muted'}`}>尚未绑定手机号</p>;
  const masked = phone.length > 7 ? `${phone.slice(0, 3)} ${'•'.repeat(phone.length - 7)} ${phone.slice(-4)}` : '••••';
  return (
    <div className={`flex items-center gap-1 text-sm ${onPhoto ? 'text-photo-muted' : 'text-muted'}`}>
      <span className="tabular-nums">{visible ? phone : masked}</span>
      <button
        type="button"
        aria-label={visible ? '隐藏手机号' : '显示手机号'}
        aria-pressed={visible}
        onClick={() => setVisible(value => !value)}
        className={`grid size-11 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${onPhoto ? 'hover:bg-photo-glass/10 hover:text-photo-ink' : 'hover:bg-surface-soft hover:text-ink'}`}
      >
        {visible ? <Eye aria-hidden="true" className="size-4" /> : <EyeOff aria-hidden="true" className="size-4" />}
      </button>
    </div>
  );
}
