'use client';

import { useState } from 'react';

/** One store per mounted owner, isolated between server render requests.
 * Key the owner by account/conversation/room when its identity can change.
 * Store factories are pure; connections, timers and cleanup belong in effects.
 */
export function useStoreInstance<T>(create: () => T): T {
  const [store] = useState(create);
  return store;
}

export { useStore } from 'zustand';
export { useShallow } from 'zustand/react/shallow';
