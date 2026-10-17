import { createAuthFormStore as createCoreAuthFormStore, type AuthFormStore as CoreAuthFormStore, type AuthFormServices, type StateUpdate } from '@my-platform/client-core';
import { withPresentation } from '../with-presentation';
type AuthPresentation = {
  showPassword: boolean; noticeOpen: boolean;
  setShowPassword: (value: StateUpdate<boolean>) => void;
  setNoticeOpen: (open: boolean) => void;
};
export type AuthFormStore = CoreAuthFormStore & AuthPresentation;
export function createAuthFormStore(services: AuthFormServices) {
  return withPresentation<CoreAuthFormStore, AuthPresentation>(createCoreAuthFormStore(services), (set) => ({
    showPassword: false, noticeOpen: false,
    setShowPassword: value => set(s => ({ showPassword: typeof value === 'function' ? value(s.showPassword) : value })),
    setNoticeOpen: noticeOpen => set({ noticeOpen }),
  }));
}
