export type Preferences = {
  userOptIn: boolean; allowProactiveAI: boolean; timezone: string;
  quietStart: number; quietEnd: number; maxBatchesPer24h: number;
  minGapMinutes: number; version: number; automationEnabled: boolean; memoryOptIn: boolean;
};
export type DailyState = { version: number; currentActivity: string; mood: string; paused: boolean };
