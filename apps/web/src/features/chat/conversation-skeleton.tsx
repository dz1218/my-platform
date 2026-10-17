import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';

export function ConversationSkeleton({ layout = 'list', label = '正在加载聊天…' }: { layout?: 'list' | 'grid'; label?: string }) {
  return <SkeletonRegion kind="conversations" label={label} className={layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'grid gap-1'}>
    {Array.from({ length: layout === 'grid' ? 6 : 3 }, (_, index) => <div key={index} className={`flex min-w-0 items-center gap-4 rounded-control ${layout === 'grid' ? 'bg-surface-soft/40 p-5' : 'px-2 py-5'}`}>
      <SkeletonBlock className="size-12 shrink-0 rounded-full sm:size-14" />
      <div className="min-w-0 flex-1"><SkeletonBlock className="h-5 w-3/5" /><SkeletonBlock className="mt-3 h-3 w-4/5" /></div>
    </div>)}
  </SkeletonRegion>;
}
