import { createDomainStore } from '../create-store';

export type PasswordResult = { error?: string; success?: boolean; retryAfter?: number; ticket?: string };
type PasswordMode = 'reset' | 'change';
type PasswordSettingsState = {
  open: boolean; busy: boolean; mode: PasswordMode;
  show: () => void; close: () => void; setBusy: (busy: boolean) => void;
  switchMode: (mode: PasswordMode) => void;
};
export const createPasswordSettingsStore = () => createDomainStore<PasswordSettingsState>()((set, get) => ({
  open: false, busy: false, mode: 'change',
  show: () => set({ open: true, mode: 'change' }),
  close: () => { if (!get().busy) set({ open: false }); },
  setBusy: busy => set({ busy }),
  switchMode: mode => { if (!get().busy) set({ mode }); },
}));

export type PasswordServices = {
  sendCode: (phone: string) => Promise<PasswordResult>;
  verifyCode: (phone: string, code: string) => Promise<PasswordResult>;
  now?: () => number;
};
type PasswordFields = { phone: string; code: string; ticket: string; currentPassword: string; password: string; confirm: string };
const emptyFields = (): PasswordFields => ({ phone: '', code: '', ticket: '', currentPassword: '', password: '', confirm: '' });

// UTF-8 bytes, matching Go/bcrypt. No browser API is needed by the core package.
export function passwordByteLength(value: string) {
  let length = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}
export function validatePassword(password: string, confirm: string) {
  const bytes = passwordByteLength(password);
  return bytes < 8 || bytes > 72 ? 'invalid_password' : password !== confirm ? 'mismatch' : '';
}

type PasswordState = PasswordFields & {
  revision: number; sending: boolean; verifying: boolean; submitting: boolean;
  cooldown: number; resendAt: number; error: string; notice: string;
  showPassword: boolean; confirmTouched: boolean;
};
type PasswordActions = {
  setField: (field: keyof Omit<PasswordFields, 'ticket'>, value: string) => void;
  togglePassword: () => void;
  touchConfirm: () => void;
  sendCode: () => Promise<void>;
  verifyPhone: () => Promise<void>;
  beginSubmit: (mode: 'reset' | 'change') => boolean;
  finishSubmit: (result: PasswordResult) => void;
  tickCooldown: () => void;
  back: () => void;
  clear: () => void;
};
export type PasswordFormStore = PasswordState & PasswordActions;
export function createPasswordFormStore(services: PasswordServices) {
  const now = services.now ?? Date.now;
  return createDomainStore<PasswordFormStore>()((set, get) => ({
    ...emptyFields(), revision: 0, sending: false, verifying: false, submitting: false,
    cooldown: 0, resendAt: 0, error: '', notice: '', showPassword: false, confirmTouched: false,
    setField: (field, value) => set(state => {
      if (state.submitting) return state;
      if (field === 'phone' || field === 'code') value = value.replace(/\D/g, '');
      return { [field]: value, error: '', ...(field === 'phone' && state.phone !== value
        ? { ticket: '', code: '', password: '', confirm: '', revision: state.revision + 1, sending: false, verifying: false, notice: '' } : {}) };
    }),
    togglePassword: () => set(state => ({ showPassword: !state.showPassword })),
    touchConfirm: () => set({ confirmTouched: true }),
    sendCode: async () => {
      const state = get();
      if (state.sending || state.verifying || state.submitting || state.resendAt > now()) return;
      if (!/^1[3-9]\d{9}$/.test(state.phone)) { set({ error: 'invalid_phone' }); return; }
      const { phone, revision } = state;
      set({ sending: true, error: '', notice: '' });
      let result: PasswordResult;
      try { result = await services.sendCode(phone); } catch { result = { error: 'unavailable' }; }
      if (get().revision !== revision) return;
      const retry = Number.isFinite(result.retryAfter) && result.retryAfter! > 0 ? Math.ceil(result.retryAfter!) : result.error ? 0 : 60;
      set({ sending: false, error: result.error ?? '', notice: result.error ? '' : '若该手机号已注册，你将收到验证码，5 分钟内有效。',
        cooldown: retry, resendAt: now() + retry * 1000 });
    },
    verifyPhone: async () => {
      const { phone, code, revision, sending, verifying, submitting } = get();
      if (sending || verifying || submitting) return;
      if (!/^1[3-9]\d{9}$/.test(phone)) { set({ error: 'invalid_phone' }); return; }
      if (!/^\d{6}$/.test(code)) { set({ error: 'invalid_code' }); return; }
      set({ verifying: true, error: '' });
      let result: PasswordResult;
      try { result = await services.verifyCode(phone, code); } catch { result = { error: 'unavailable' }; }
      if (get().revision !== revision) return;
      set({ verifying: false, error: result.error ?? (result.ticket ? '' : 'unavailable'),
        ...(result.ticket ? { ticket: result.ticket, code: '', notice: '' } : {}) });
    },
    beginSubmit: mode => {
      const state = get();
      if (state.submitting || state.verifying || state.sending) return false;
      const error = mode === 'change' && !state.currentPassword ? 'current_password_required'
        : mode === 'reset' && !state.ticket ? 'verification_expired'
        : validatePassword(state.password, state.confirm) || (mode === 'change' && state.password === state.currentPassword ? 'same_password' : '');
      set({ error, confirmTouched: true, submitting: !error });
      return !error;
    },
    finishSubmit: result => {
      if (result.success) get().clear();
      else set({ submitting: false, error: result.error ?? 'unavailable' });
    },
    tickCooldown: () => set(state => ({ cooldown: Math.max(0, Math.ceil((state.resendAt - now()) / 1000)) })),
    back: () => {
      if (get().submitting) return;
      set(state => ({ ticket: '', code: '', password: '', confirm: '', currentPassword: '', revision: state.revision + 1,
        verifying: false, sending: false, error: '', notice: '', showPassword: false, confirmTouched: false }));
    },
    clear: () => set(state => ({ ...emptyFields(), revision: state.revision + 1, sending: false, verifying: false, submitting: false,
      error: '', notice: '', cooldown: 0, resendAt: 0, showPassword: false, confirmTouched: false })),
  }));
}
