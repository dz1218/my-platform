'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MobileAccountContent } from '@my-platform/mobile-web/account';
import { MobilePullToRefresh } from '@my-platform/mobile-web/pull-to-refresh';
import { useViewport } from '@my-platform/web-ui/use-viewport';
import { useBrowseUI } from '@/stores/provider';
import Link from 'next/link';
import { MatchLink } from '@/features/chat/match-link';
import { ConversationSkeleton } from '@/features/chat/conversation-skeleton';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, MessageCircle, Plus, RefreshCw } from 'lucide-react';
import { Avatar } from '@/features/identity/avatar';
import { matchesQueryOptions } from '@/services/query-options';
import type { Identity } from '@/types/companion';
import { ProfileChatHeading, ProfileTabs, profileTabs, type ProfileTab } from './profile-frame';

const CHAT_PAGE_SIZE = 6;

export function ProfileContent({ accountId, identity }: { accountId: string; identity: Identity | null }) {
  const viewport = useViewport();
  const tab = useBrowseUI(s => s.profileTab);
  const setTab = useBrowseUI(s => s.setProfileTab);
  const savedPage = useBrowseUI(s => s.profileChatPage);
  const setPage = useBrowseUI(s => s.setProfileChatPage);
  const chatListRef = useRef<HTMLUListElement>(null);
  const [indicatorMotion, setIndicatorMotion] = useState<'left' | 'right' | null>(null);
  const selectTab = (next: ProfileTab) => {
    if (next === tab) return;
    setIndicatorMotion(next === 'identity' ? 'right' : 'left');
    setTab(next);
  };
  const conversations = useQuery(matchesQueryOptions(accountId));
  const recent = conversations.data?.items.filter(match => match.identity.id !== identity?.id);
  const pageCount = Math.max(1, Math.ceil((recent?.length ?? 0) / CHAT_PAGE_SIZE));
  const page = Math.min(savedPage, pageCount);
  const visibleChats = recent?.slice((page - 1) * CHAT_PAGE_SIZE, page * CHAT_PAGE_SIZE);
  useEffect(() => {
    if (conversations.data && savedPage !== page) setPage(page);
  }, [conversations.data, savedPage, page, setPage]);
  function changePage(next: number) {
    setPage(Math.max(1, Math.min(next, pageCount)));
    chatListRef.current?.focus({ preventScroll: true });
    chatListRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else return;
    event.preventDefault();
    selectTab(profileTabs[next].id);
    document.getElementById(`profile-tab-${profileTabs[next].id}`)?.focus();
  }

  const recentPanel = <>
      <ProfileChatHeading count={recent?.length} actions={<div className="flex items-center gap-2"><button type="button" aria-label="刷新最近聊天" title="刷新最近聊天" disabled={conversations.isFetching} onClick={() => void conversations.refetch()} className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${conversations.isFetching ? 'motion-safe:animate-spin' : ''}`} /></button><Link href="/companion?view=discover" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm text-muted transition-colors hover:text-ink">认识新朋友<ChevronRight aria-hidden="true" className="size-4" /></Link></div>} />
      {conversations.isError && <div role="alert" className="mb-4 rounded-panel bg-panel p-6"><p className="text-sm">{conversations.data ? '聊天更新失败，已保留上次内容' : '聊天暂时加载失败'}</p><button type="button" disabled={conversations.isFetching} className="btn-secondary mt-4" onClick={() => void conversations.refetch()}>重试</button></div>}
      {conversations.isPending ? <ConversationSkeleton layout={viewport === 'mobile' ? 'list' : 'grid'} /> : recent?.length ? <ul ref={chatListRef} id="profile-chat-list" aria-label="最近聊天" tabIndex={-1} className="grid scroll-mt-6 gap-2 md:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleChats?.map(match => <li key={match.id} data-browse-anchor={`match:${match.id}`}><MatchLink match={match} aria-label={`继续和${match.identity.name}聊天`} className="group flex h-full items-center gap-4 rounded-panel bg-panel px-4 py-5 md:rounded-control md:bg-surface-soft/40 md:p-5 transition-shadow duration-200 hover:shadow-card-hover-glow focus-visible:shadow-card-hover-glow motion-reduce:transition-none">
          <Avatar identity={match.identity} large />
          <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{match.identity.name}</span><span className="mt-2 block text-xs text-muted">继续你们的对话</span></span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted group-hover:text-ink" />
        </MatchLink></li>)}
      </ul> : conversations.data && <div className="flex flex-col items-start gap-5 py-5 sm:flex-row sm:items-center sm:py-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-soft text-muted"><MessageCircle aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-medium">还没有开始的对话</h3><p className="mt-2 text-sm leading-6 text-muted">认识一位朋友，聊过之后就能在这里找到 TA。</p></div>
      </div>}
      {!!recent?.length && pageCount > 1 && <nav aria-label="聊天分页" className="mt-5 flex items-center justify-between gap-3">
        <button type="button" aria-controls="profile-chat-list" disabled={page === 1} onClick={() => changePage(page - 1)} className="btn-secondary min-h-11 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
        <span role="status" aria-live="polite" className="text-sm tabular-nums text-muted">第 {page} / {pageCount} 页</span>
        <button type="button" aria-controls="profile-chat-list" disabled={page === pageCount} onClick={() => changePage(page + 1)} className="btn-secondary min-h-11 disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
      </nav>}
  </>;
  const identityPanel = <>
      <div className="mb-4 flex min-h-11 items-center justify-between gap-3"><h2 className="text-base font-semibold">你的 AI 身份</h2><span className="text-xs text-muted">{identity ? '已继承' : '未选择'}</span></div>
      <Link href={identity ? '/operator' : '/choose-identity'} aria-label={identity ? `以${identity.name}的身份回复` : '选择 AI 身份'} className="group flex items-center gap-4 rounded-panel bg-panel p-5 md:rounded-control md:bg-surface-soft/40 transition-shadow duration-200 hover:shadow-card-hover-glow focus-visible:shadow-card-hover-glow motion-reduce:transition-none sm:gap-5 sm:p-6">
        {identity ? <Avatar identity={identity} large /> : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full border border-dashed border-control text-muted sm:size-14"><Plus className="size-5" /></span>}
        <span className="min-w-0 flex-1"><span className="block wrap-anywhere font-medium">{identity ? identity.name : '添加你的 AI 身份'}</span><span className="mt-2 block text-sm leading-6 text-muted">{identity ? '以这个身份回复消息，管理 AI 托管。' : '以角色身份与其他真实用户聊天，本账户依然保留。'}</span></span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted group-hover:text-ink" />
      </Link>
      {!identity && <details className="group mt-3">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-sm text-xs text-muted hover:text-ink [&::-webkit-details-marker]:hidden">关于身份继承<ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
        <p className="max-w-prose pb-2 text-xs leading-6 text-muted">每个账户只能继承一个同性别的 AI 身份，确认后不可更换。你可以先浏览角色资料，再决定是否继承。本账户仍然保留。</p>
      </details>}
  </>;
  return <div>
    <MobilePullToRefresh enabled={viewport === 'mobile'} label="最近聊天" busy={conversations.isFetching} onRefresh={() => conversations.refetch({ throwOnError: true, cancelRefetch: false })} />
    <ProfileTabs tab={tab} indicatorMotion={indicatorMotion} onSelect={selectTab} onKeyDown={onTabKey} />
    {viewport === 'mobile' ? <MobileAccountContent tab={tab} recent={recentPanel} identity={identityPanel} /> : <>
      <section role="tabpanel" id="profile-panel-recent" aria-labelledby="profile-tab-recent" hidden={tab !== 'recent'} tabIndex={0} className="p-4 sm:p-6">{recentPanel}</section>
      <section role="tabpanel" id="profile-panel-identity" aria-labelledby="profile-tab-identity" hidden={tab !== 'identity'} tabIndex={0} className="p-4 sm:p-6">{identityPanel}</section>
    </>}
  </div>;
}
