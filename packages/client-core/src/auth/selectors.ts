import type { AuthFormStore } from './store';

export const authFormSelectors = {
  view: (s: AuthFormStore) => ({
    phone: s.phone,
    code: s.code,
    ticket: s.ticket,
    password: s.password,
    confirm: s.confirm,
    confirmTouched: s.confirmTouched,
    name: s.name,
    gender: s.gender,
    consent: s.consent,
    localError: s.localError,
    notice: s.notice,
    verifying: s.verifying,
    sending: s.sending,
    cooldown: s.cooldown,
  }),
};

