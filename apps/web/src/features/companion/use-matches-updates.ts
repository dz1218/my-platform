'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MatchesConnection } from '@/services/matches-connection';

export function useMatchesUpdates(accountId: string, paused: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (paused || !accountId) return;
    const queryKey = ['matches', accountId];
    let stopped = false;
    let revision = 0;
    const connection = new MatchesConnection(items => {
      const snapshotRevision = ++revision;
      // An initial/focus HTTP request may contain an older list. Abort it
      // before publishing the authoritative snapshot to the account's cache.
      void client.cancelQueries({ queryKey, exact: true }).then(() => {
        if (!stopped && snapshotRevision === revision) {
          client.setQueryData(queryKey, { items });
        }
      });
    });
    return () => {
      stopped = true;
      connection.close();
    };
  }, [accountId, paused, client]);
}
