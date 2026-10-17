'use client';

import { useState, type KeyboardEvent } from 'react';
import { useBrowseUI } from '@/stores/provider';
import Link from 'next/link';
import { MatchLink } from '@/features/chat/match-link';
import { InlineLoading } from '@/components/page-skeleton';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, MessageCircle, Plus, RefreshCw } from 'lucide-react';
import { Avatar } from '@/features/identity/avatar';
import { matchesQueryOptions } from '@/services/query-options';
import type { Identity } from '@/types/companion';

type Tab = 'recent' | 'identity';
const tabs: { id: Tab; label: string }[] = [{ id: 'recent', label: '最近聊天' }, { id: 'identity', label: 'AI 身份' }];

export function ProfileContent({ accountId, identity }: { accountId: string; identity: Identity | null }) {
  const tab = useBrowseUI(s => s.profileTab);
  const setTab = useBrowseUI(s => s.setProfileTab);
  const [indicatorMotion, setIndicatorMotion] = useState<'left' | 'right' | null>(null);
  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setIndicatorMotion(next === 'identity' ? 'right' : 'left');
    setTab(next);
  };
  const conversations = useQuery(matchesQueryOptions(accountId));
  const recent = conversations.data?.items.filter(match => match.identity.id !== identity?.id);
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].id);
    document.getElementById(`profile-tab-${tabs[next].id}`)?.focus();
  }

  return <div>
    <div className="border-b border-line/60 px-4 sm:px-6">
      <div role="tablist" aria-label="个人主页内容" className="relative inline-grid grid-cols-2 gap-2">
        {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`profile-tab-${item.id}`} aria-controls={`profile-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => selectTab(item.id)} onKeyDown={event => onTabKey(event, index)} className={`relative flex min-h-14 w-28 items-center justify-center px-3 text-sm font-medium leading-5 transition-colors sm:w-32 ${tab === item.id ? 'text-ink' : 'text-muted hover:text-ink'}`}>
          {item.label}
        </button>)}
        <span aria-hidden="true" className="profile-tab-indicator pointer-events-none absolute bottom-0 left-0" data-active={tab} data-direction={indicatorMotion}>
          <span className="profile-tab-line mx-5 block h-[3px] rounded-full bg-profile-tab-gradient shadow-profile-tab" />
        </span>
      </div>
    </div>

    <section role="tabpanel" id="profile-panel-recent" aria-labelledby="profile-tab-recent" hidden={tab !== 'recent'} tabIndex={0} className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">你的聊天{recent && <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-line/60 bg-surface-soft/70 px-2 text-xs font-medium leading-none tabular-nums text-ink">{recent.length}</span>}</h2>
        <div className="flex items-center gap-2"><button type="button" aria-label="刷新最近聊天" title="刷新最近聊天" disabled={conversations.isFetching} onClick={() => void conversations.refetch()} className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${conversations.isFetching ? 'motion-safe:animate-spin' : ''}`} /></button><Link href="/companion?view=discover" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm text-muted transition-colors hover:text-ink">认识新朋友<ChevronRight aria-hidden="true" className="size-4" /></Link></div>
      </div>
      {conversations.isError && <div role="alert" className="mb-4 rounded-panel bg-panel p-6"><p className="text-sm">{conversations.data ? '聊天更新失败，已保留上次内容' : '聊天暂时加载失败'}</p><button type="button" disabled={conversations.isFetching} className="btn-secondary mt-4" onClick={() => void conversations.refetch()}>重试</button></div>}
      {conversations.isPending ? <InlineLoading label="正在加载聊天…" /> : recent?.length ? <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {recent.map(match => <li key={match.id} data-browse-anchor={`match:${match.id}`}><MatchLink match={match} aria-label={`继续和${match.identity.name}聊天`} className="group flex h-full items-center gap-4 rounded-control bg-surface-soft/40 p-5 transition-shadow duration-200 hover:shadow-card-hover-glow focus-visible:shadow-card-hover-glow motion-reduce:transition-none">
          <Avatar identity={match.identity} large />
          <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{match.identity.name}</span><span className="mt-2 block text-xs text-muted">继续你们的对话</span></span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted group-hover:text-ink" />
        </MatchLink></li>)}
      </ul> : conversations.data && <div className="flex flex-col items-start gap-5 py-5 sm:flex-row sm:items-center sm:py-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-soft text-muted"><MessageCircle aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-medium">还没有开始的对话</h3><p className="mt-2 text-sm leading-6 text-muted">认识一位朋友，聊过之后就能在这里找到 TA。</p></div>
      </div>}
    </section>

    <section role="tabpanel" id="profile-panel-identity" aria-labelledby="profile-tab-identity" hidden={tab !== 'identity'} tabIndex={0} className="p-4 sm:p-6">
      <div className="mb-4 flex min-h-11 items-center justify-between gap-3"><h2 className="text-base font-semibold">你的 AI 身份</h2><span className="text-xs text-muted">{identity ? '已继承' : '未选择'}</span></div>
      <Link href={identity ? '/operator' : '/choose-identity'} aria-label={identity ? `以${identity.name}的身份回复` : '选择 AI 身份'} className="group flex items-center gap-4 rounded-control bg-surface-soft/40 p-5 transition-shadow duration-200 hover:shadow-card-hover-glow focus-visible:shadow-card-hover-glow motion-reduce:transition-none sm:gap-5 sm:p-6">
        {identity ? <Avatar identity={identity} large /> : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full border border-dashed border-control text-muted sm:size-14"><Plus className="size-5" /></span>}
        <span className="min-w-0 flex-1"><span className="block wrap-anywhere font-medium">{identity ? identity.name : '添加你的 AI 身份'}</span><span className="mt-2 block text-sm leading-6 text-muted">{identity ? '以这个身份回复消息，管理 AI 托管。' : '以角色身份与其他真实用户聊天，本账户依然保留。'}</span></span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted group-hover:text-ink" />
      </Link>
      {!identity && <details className="group mt-3">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-sm text-xs text-muted hover:text-ink [&::-webkit-details-marker]:hidden">关于身份继承<ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
        <p className="max-w-prose pb-2 text-xs leading-6 text-muted">每个账户只能继承一个同性别的 AI 身份，确认后不可更换。你可以先浏览角色资料，再决定是否继承。本账户仍然保留。</p>
      </details>}
    </section>
  </div>;
}
