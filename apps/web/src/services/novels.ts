import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { serverFetch } from '@/services/api/server';

export type Chapter = { id: string; title: string; content: string; orderIndex: number; published: boolean; novelId: string };
export type Novel = {
  id: string; title: string; description: string; status: string; authorId: string;
  author: { id: string; name: string }; chapterCount: number; chapters: Chapter[];
};
export async function novelRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await serverFetch(path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  if (response.status === 401) redirect('/login');
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('暂时无法加载或保存小说，请稍后重试');
  return response.json() as Promise<T>;
}
export const listNovels = () => novelRequest<{ items: Novel[] }>('/novels');
export const getNovel = (id: string) => novelRequest<Novel>(`/novels/${encodeURIComponent(id)}`);
export async function getChapter(novelId: string, chapterId: string) {
  const [chapter, novel] = await Promise.all([
    novelRequest<Chapter>(`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`),
    getNovel(novelId),
  ]);
  return { ...chapter, novel };
}
