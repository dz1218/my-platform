export type MemoryKind = 'FACT' | 'PREFERENCE' | 'EXPERIENCE' | 'BOUNDARY';
export type CompanionMemory = {
  id: string; kind: MemoryKind; content: string; sourceMessageId: string;
  provenance: string; version: number; manual: boolean; factKey?: string; reason?: string; validUntil?: string | null;
  assertion?: 'ASSERTION' | 'PLAN' | 'UNCERTAIN';
};
export type MemoryPreferences = { enabled: boolean; version: number; consentVersion: number };
export type MemoryCollection = { items: CompanionMemory[]; proposals: CompanionMemory[]; nextCursor?: number };
