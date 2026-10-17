import type { QueryClient } from '@tanstack/query-core';
import type { ApiRoomItem, LiveRoomDetail, LiveRoomsUpdate } from '@my-platform/shared';

/** A mounted account/room owns this writer; it stores data only in QueryClient. */
export function createLiveRoomUpdates(client: QueryClient, apiBaseUrl: string, roomId?: string) {
  const listKey = ['live-rooms', apiBaseUrl];
  const queryKey = roomId ? ['live-room', apiBaseUrl, roomId] : listKey;
  let revision = 0;
  let stopped = false;
  return {
    receive: async (event: LiveRoomsUpdate) => {
      if (stopped) return;
      if (roomId ? event.type === 'rooms.updated' || (event.type === 'room.updated' ? event.detail.item.id : event.roomId) !== roomId : event.type !== 'rooms.updated') return;
      const current = ++revision;
      await client.cancelQueries({ queryKey, exact: true });
      if (stopped || current !== revision) return;
      if (event.type === 'rooms.updated') {
        client.setQueryData<ApiRoomItem[]>(listKey, event.items);
        return;
      }
      client.setQueryData<LiveRoomDetail | null>(queryKey, event.type === 'room.updated' ? event.detail : null);
      // Keep a previously visited lobby coherent without creating a second
      // cache or opening a second subscription in the room.
      await client.cancelQueries({ queryKey: listKey, exact: true });
      if (stopped || current !== revision) return;
      client.setQueryData<ApiRoomItem[]>(listKey, rooms => rooms?.flatMap(item => {
        if (item.id !== roomId) return [item];
        return event.type === 'room.updated' && event.detail.state === 'open' ? [event.detail.item] : [];
      }));
    },
    close: () => { stopped = true; revision++; },
  };
}
