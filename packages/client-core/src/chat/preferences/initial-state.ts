import type { Preferences, DailyState } from '@my-platform/shared';
export type { Preferences, DailyState } from '@my-platform/shared';

export type PreferencesState = {
  error: string;
  notice: string;
  busy: boolean;
  policyDraft: { version: number; allow: boolean } | null;
  dailyDraft: DailyState | null;
};

export const initialPreferencesState = (): PreferencesState => ({
  error: '',
  notice: '',
  busy: false,
  policyDraft: null,
  dailyDraft: null,
});

