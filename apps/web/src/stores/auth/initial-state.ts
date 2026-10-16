import type { Gender } from '@/types/companion';

export type AuthFormState = {
  phoneVersion: number;
  phone: string;
  code: string;
  ticket: string;
  password: string;
  confirm: string;
  confirmTouched: boolean;
  name: string;
  gender: Gender | '';
  consent: boolean;
  localError: string;
  notice: string;
  verifying: boolean;
  sending: boolean;
  cooldown: number;
  showPassword: boolean;
  noticeOpen: boolean;
};

export const initialAuthFormState = (): AuthFormState => ({
  phoneVersion: 0,
  phone: '',
  code: '',
  ticket: '',
  password: '',
  confirm: '',
  confirmTouched: false,
  name: '',
  gender: '',
  consent: false,
  localError: '',
  notice: '',
  verifying: false,
  sending: false,
  cooldown: 0,
  showPassword: false,
  noticeOpen: false,
});

