'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore, type ReactNode } from 'react';
import { novelShelfQueryKey } from '@/services/novel-shelf';

const subscribeHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

/** Keep the native server action/redirect intact, including without JavaScript. */
export function NovelMutationForm({ action, confirmMessage, children, className }: {
  action: (data: FormData) => void | Promise<void>;
  confirmMessage?: string;
  children: ReactNode;
  className?: string;
}) {
  const client = useQueryClient();
  const hydrated = useSyncExternalStore(subscribeHydration, hydratedSnapshot, serverSnapshot);
  async function submit(data: FormData) {
    try { await action(data); }
    finally {
      // The action can redirect or the editor can unmount while saving. This
      // continuation still runs after the write. Cancel explicitly because an
      // initial read without cached data is otherwise reused by invalidation.
      await client.cancelQueries({ queryKey: novelShelfQueryKey });
      void client.invalidateQueries({ queryKey: novelShelfQueryKey });
    }
  }
  return <form action={hydrated ? submit : action} className={className} onSubmit={event => {
    if (confirmMessage && !window.confirm(confirmMessage)) { event.preventDefault(); return; }
    // Mark before the server redirect so unmounting cannot skip invalidation.
    // A failed write may also refresh on return, but never hides existing data.
    void client.invalidateQueries({ queryKey: novelShelfQueryKey, refetchType: 'none' });
  }}>{children}</form>;
}
