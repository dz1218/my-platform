'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { APIError } from '@/services/api/client';
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: (count, error) => !(error instanceof APIError && error.status < 500) && count < 1 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
