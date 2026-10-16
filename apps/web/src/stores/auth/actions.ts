import type { StateCreator } from 'zustand/vanilla';
import type { AuthFormState } from './initial-state';
import type { AuthFormStore } from './store';
import type { StateUpdate } from '@/stores/types';

export type AuthFormServices = {
  sendCode: (phone: string) => Promise<{ error?: string; retryAfter?: number }>;
  verifyCode: (phone: string, code: string) => Promise<{ error?: string; ticket?: string }>;
};
export type AuthFormActions = {
  sendCode: () => Promise<'invalid_phone' | 'done'>;
  verifyPhone: (code: string) => Promise<void>;
  credentialsMatch: (password: string, confirm: string) => boolean;
  beginSendCode: () => boolean;
  finishSendCode: (version: number, error?: string, retryAfter?: number) => void;
  beginVerification: () => boolean;
  finishVerification: (version: number, result: { error?: string; ticket?: string }) => void;
  tickCooldown: () => void;
  setPhone: (phone: string) => void;
  setCode: (code: string) => void;
  setPassword: (password: string) => void;
  setConfirm: (confirm: string) => void;
  setConfirmTouched: (touched: boolean) => void;
  setName: (name: string) => void;
  setGender: (gender: AuthFormState['gender']) => void;
  setConsent: (consent: boolean) => void;
  setShowPassword: (value: StateUpdate<boolean>) => void;
  setNoticeOpen: (open: boolean) => void;
};

type Creator = StateCreator<AuthFormStore, [['zustand/subscribeWithSelector', never]], [], AuthFormActions>;
export const createAuthActions = (services: AuthFormServices): Creator => (set, get) => ({
  sendCode: async () => {
    const { phone, phoneVersion } = get();
    if (!/^1[3-9]\d{9}$/.test(phone)) { set({ localError: 'invalid_phone' }); return 'invalid_phone'; }
    if (!get().beginSendCode()) return 'done';
    try {
      const result = await services.sendCode(phone);
      get().finishSendCode(phoneVersion, result.error, result.retryAfter);
    }
    catch { get().finishSendCode(phoneVersion, 'unavailable'); }
    return 'done';
  },
  verifyPhone: async code => {
    if (!get().beginVerification()) return;
    const { phone, phoneVersion } = get();
    try { get().finishVerification(phoneVersion, await services.verifyCode(phone, code)); }
    catch { get().finishVerification(phoneVersion, { error: 'unavailable' }); }
  },
  credentialsMatch: (password, confirm) => { set({ confirmTouched: true }); return password === confirm; },
  beginSendCode: () => {
    const s = get();
    if (s.sending || s.verifying || s.cooldown > 0) return false;
    set({ sending: true, localError: '', notice: '' });
    return true;
  },
  finishSendCode: (version, error, retryAfter) => set(s => ({
    sending: false,
    cooldown: Number.isFinite(retryAfter) && retryAfter! > 0
      ? Math.ceil(retryAfter!) : !error || error === 'rate_limit' ? 60 : s.cooldown,
    ...(s.phoneVersion === version ? { localError: error ?? '', notice: error ? '' : '验证码已发送，5 分钟内有效。' } : {}),
  })),
  beginVerification: () => {
    if (get().verifying) return false;
    set({ verifying: true, localError: '' });
    return true;
  },
  finishVerification: (version, result) => set(s => ({
    verifying: false,
    ...(s.phoneVersion === version ? { localError: result.error ?? '', ticket: result.ticket ?? s.ticket, notice: result.ticket ? '' : s.notice } : {}),
  })),
  tickCooldown: () => set(s => ({ cooldown: Math.max(0, s.cooldown - 1) })),
  setPhone: value => set(s => {
    const phone = value.replace(/\D/g, '');
    return { phone, localError: '', notice: '', ...(phone !== s.phone ? { ticket: '', phoneVersion: s.phoneVersion + 1 } : {}) };
  }),
  setCode: code => set(s => ({ code: code.replace(/\D/g, ''), localError: s.localError === 'invalid_code' ? '' : s.localError })),
  setPassword: password => set(s => ({ password, confirmTouched: s.confirmTouched || !!s.confirm })),
  setConfirm: confirm => set({ confirm }),
  setConfirmTouched: confirmTouched => set({ confirmTouched }),
  setName: name => set({ name }),
  setGender: gender => set({ gender }),
  setConsent: consent => set({ consent }),
  setShowPassword: value => set(s => ({ showPassword: typeof value === 'function' ? value(s.showPassword) : value })),
  setNoticeOpen: noticeOpen => set({ noticeOpen }),
});
