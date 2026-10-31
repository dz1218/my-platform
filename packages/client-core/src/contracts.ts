import type { QueryFunctionContext } from '@tanstack/query-core';
import type { ApiRoomItem, AutoReply, Gender, Identity, Match, MessagePage } from '@my-platform/shared';

export type RequestIdFactory = () => string;
export type MessageHistory = (id: string, before?: string, signal?: QueryFunctionContext['signal']) => Promise<MessagePage>;
export type CompanionService = { meet: (identityId: string) => Promise<Match> };
export type IdentityService = {
  inheritIdentity: (identityId: string) => Promise<{ identity: Identity }>;
  skipInheritance: () => Promise<unknown>;
  setInheritanceGender: (gender: Gender) => Promise<unknown>;
};
export type AutoReplyService = {
  configureAutoReply: (id: string, mode: AutoReply['mode'], delaySeconds: number) => Promise<AutoReply>;
  takeover: (id: string, ownerType: AutoReply['ownerType']) => Promise<AutoReply>;
};
export type PreferencesService = { write: (id: string, path: string, body: unknown, method: string) => Promise<unknown> };
export type LiveLobbyService = {
  create: (title: string) => Promise<{ item: ApiRoomItem; conflict?: string }>;
  close: (id: string) => Promise<import('@my-platform/shared').LiveRoomClose | void>;
  detail?: (id: string) => Promise<import('@my-platform/shared').LiveRoomDetail>;
  refresh?: () => Promise<ApiRoomItem[]>;
};
export type MediaDevice = 'camera' | 'microphone';
export type MediaErrorMessage = (error: unknown, device: MediaDevice) => string;
