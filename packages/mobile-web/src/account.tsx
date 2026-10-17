import type { KeyboardEvent, ReactNode } from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';

export type MobileAccountTab = 'recent' | 'identity';

export function MobileAccountHeader({ avatar, details, cover, actions }: {
  avatar: ReactNode; details: ReactNode; cover: ReactNode; actions?: ReactNode;
}) {
  return <header className="relative isolate px-5 pb-6 pt-14">
      <div aria-hidden="true" className="profile-cover-media pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 overflow-hidden opacity-70">{cover}</div>
      {actions && <div className="absolute right-4 top-3">{actions}</div>}
      <span aria-hidden="true" className="mb-4 grid size-16 place-items-center rounded-full border border-line bg-panel text-2xl text-ink">{avatar}</span>
      <div data-profile-details className="min-w-0">{details}</div>
    </header>;
}

export function MobileAccountTabs({ tab, disabled, onSelect, onKeyDown }: {
  tab: MobileAccountTab;
  disabled?: boolean;
  onSelect?: (tab: MobileAccountTab) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  return <div role="tablist" aria-label="个人主页内容" className="mb-2 grid grid-cols-2 gap-1 rounded-full bg-panel p-1">
    {([{ id: 'recent', label: '最近聊天', Icon: MessageCircle }, { id: 'identity', label: 'AI 身份', Icon: Sparkles }] as const).map(({ id, label, Icon }, index) => <button
      key={id} id={`profile-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`profile-panel-${id}`}
      disabled={disabled} tabIndex={!disabled && tab === id ? 0 : -1} onClick={() => onSelect?.(id)} onKeyDown={event => onKeyDown?.(event, index)}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-full px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transition-none ${tab === id ? 'bg-surface-selected text-ink' : 'text-muted enabled:hover:bg-surface-soft enabled:hover:text-ink'}`}>
      <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />{label}
    </button>)}
  </div>;
}

/** The application owns queries and links; these slots contain one active panel. */
export function MobileAccountContent({ tab, recent, identity }: { tab: MobileAccountTab; recent: ReactNode; identity: ReactNode }) {
  return <>
    <section role="tabpanel" id="profile-panel-recent" aria-labelledby="profile-tab-recent" hidden={tab !== 'recent'} tabIndex={0} className="py-5">{recent}</section>
    <section role="tabpanel" id="profile-panel-identity" aria-labelledby="profile-tab-identity" hidden={tab !== 'identity'} tabIndex={0} className="py-5">{identity}</section>
  </>;
}
