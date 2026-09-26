import type { Identity } from '@/types/companion';
const tones = ['bg-[#E8DDD6] text-[#735747]', 'bg-[#DFE7DF] text-[#4F6854]', 'bg-[#DEE5EF] text-[#4C617F]'];
export function Avatar({ identity, large = false }: { identity: Identity; large?: boolean }) {
  const index = Array.from(identity.id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % tones.length;
  return <div aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-medium ${tones[index]} ${large ? 'h-12 w-12 text-xl sm:h-14 sm:w-14' : 'h-9 w-9 text-sm'}`}>{identity.name.slice(-1)}</div>;
}
