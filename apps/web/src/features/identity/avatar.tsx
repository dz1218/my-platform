import type { Identity } from '@/types/companion';
export function Avatar({ identity, large = false }: { identity: Identity; large?: boolean }) {
  return <div aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full border border-rose-200/15 bg-gradient-to-br from-rose-300/20 via-violet-300/15 to-slate-700/30 font-serif text-rose-100 ${large ? 'h-32 w-32 text-4xl' : 'h-11 w-11 text-lg'}`}>{identity.name.slice(-1)}</div>;
}
