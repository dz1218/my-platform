export type RoomRole = 'host' | 'admin' | 'audience';

export interface RoomSummary {
  id: string;
  name: string;
  role: RoomRole;
}

export * from './companion';
export * from './catalog';
export * from './live';
export * from './preferences';
export * from './memory';
