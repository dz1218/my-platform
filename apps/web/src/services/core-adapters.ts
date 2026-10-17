import { history, configureAutoReply, takeover } from './chat';
import { meet } from './companion';
import { inheritIdentity, setInheritanceGender, skipInheritance } from './inheritance';
import { api } from './api/client';
import type { AutoReplyService, CompanionService, IdentityService, LiveChatCodec, MediaErrorMessage, PreferencesService } from '@my-platform/client-core';

// Browser/Next service wiring stays at the application boundary. The shared
// factories only receive these capabilities and never own browser resources.
export const createBrowserRequestId = () => crypto.randomUUID();
export const browserMessageHistory = history;
export const browserCompanionService: CompanionService = { meet };
export const browserIdentityService: IdentityService = { inheritIdentity, setInheritanceGender, skipInheritance };
export const browserAutoReplyService: AutoReplyService = { configureAutoReply, takeover };
export const browserPreferencesService: PreferencesService = {
  write: (id, path, body, method) => api(`/conversations/${encodeURIComponent(id)}${path}`, { method, body: JSON.stringify(body) }),
};
export const browserLiveChatCodec: LiveChatCodec = {
  encode: value => new TextEncoder().encode(value),
  decode: value => new TextDecoder().decode(value),
};
export const browserMediaError: MediaErrorMessage = (error, device) => {
  const name = device === 'camera' ? '摄像头' : '麦克风';
  return error instanceof Error && error.name === 'NotAllowedError'
    ? `未获得${name}权限，请在浏览器地址栏的网站设置中允许访问后重试。`
    : error instanceof Error && error.name === 'NotFoundError'
      ? `未找到${name}，请连接设备后重试。`
      : `${name}开启失败，请检查设备是否被其他应用占用。`;
};
