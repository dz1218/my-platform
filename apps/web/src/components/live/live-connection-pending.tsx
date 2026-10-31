'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

/** Keep the same loading frame across requests and automatic retry waits. */
export function LiveConnectionPending({ label = '正在连接直播间' }: { label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, []);

  return <div data-player-loading role="status" aria-label={label} aria-busy="true" className="pointer-events-none absolute inset-0 grid place-items-center">
    <LoaderCircle aria-hidden="true" className="size-6 text-muted motion-safe:animate-spin" strokeWidth={1.75} />
    <span className={slow ? 'absolute inset-x-4 top-[calc(50%+1.5rem)] text-center text-sm text-muted' : 'sr-only'}>{slow ? '连接时间较长，请稍候…' : label}</span>
  </div>;
}
