export type RoomRole = 'host' | 'admin' | 'audience';

export interface RoomSummary {
  id: string;
  name: string;
  role: RoomRole;
}
