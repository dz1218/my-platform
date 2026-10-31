import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api, APIError } from './api/client';
import { sessionQueryOptions } from './query-options';
import type { Novel } from './novels';

export const novelShelfQueryKey = ['novel-shelf'] as const;
export const NOVEL_PAGE_SIZE = 12;
export type NovelShelfPage = { items: Novel[]; total: number; page: number; pageSize: number };

export const novelShelfQueryOptions = (page = 1, q = '') => queryOptions({
  ...sessionQueryOptions,
  // Old full-list responses must not survive as cached search results after an update.
  queryKey: [...novelShelfQueryKey, 'pages', { page, q }],
  placeholderData: keepPreviousData,
  queryFn: async ({ signal }) => {
    const params = new URLSearchParams();
    if (page !== 1) params.set('page', String(page));
    if (q) params.set('q', q);
    const query = params.toString();
    const result = await api<NovelShelfPage>(`/novels${query ? `?${query}` : ''}`, { signal });
    if (!Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 ||
      !Number.isInteger(result.page) || result.page < 1 || !Number.isInteger(result.pageSize) || result.pageSize < 1) {
      throw new APIError('书架暂时无法更新，请稍后重试', 502, 'invalid_novel_page');
    }
    return { ...result, search: q };
  },
});
