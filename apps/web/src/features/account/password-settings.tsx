'use client';

import { useRef } from 'react';
import { useStore } from 'zustand';
import { createPasswordSettingsStore } from '@my-platform/client-core/auth';
import { useStoreInstance } from '@/stores/use-store-instance';
import { Sheet } from '@/components/sheet';
import { PasswordForm } from '@/features/auth/password-form';

/** The profile owner stays mounted when desktop/mobile header slots change. */
export function usePasswordSettings() {
  const ui = useStoreInstance(createPasswordSettingsStore);
  const open = useStore(ui, s => s.open);
  const mode = useStore(ui, s => s.mode);
  const { show, close, setBusy, switchMode } = ui.getState();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return {
    trigger: <button ref={triggerRef} type="button" aria-haspopup="dialog" onClick={show} className="inline-flex min-h-11 items-center rounded-control px-3 text-sm text-muted hover:bg-surface-soft hover:text-ink">修改密码</button>,
    dialog: open && <Sheet open onClose={close} title={mode === 'change' ? '修改密码' : '找回密码'} desktopCentered returnFocusRef={triggerRef} className="md:max-w-[480px]!">
      <div className="pb-[env(safe-area-inset-bottom)]"><PasswordForm key={mode} mode={mode} onBusyChange={setBusy} onSwitchMode={switchMode} /></div>
    </Sheet>,
  };
}
