export type Preferences = {
  userOptIn: boolean; allowProactiveAI: boolean; timezone: string;
  quietStart: number; quietEnd: number; maxBatchesPer24h: number;
  minGapMinutes: number; version: number; automationEnabled: boolean; memoryOptIn: boolean;
};
export type DailyState = { version: number; currentActivity: string; mood: string; paused: boolean };



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

