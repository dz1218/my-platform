import { SkeletonBlock, SkeletonRegion } from '@/components/skeleton';

export function CatalogSkeleton({ label = '正在寻找可以认识的人…' }: { label?: string }) {
  return <SkeletonRegion kind="catalog" label={label} className="@container">
    <div className="grid grid-cols-1 gap-4 md:@min-[480px]:grid-cols-2 md:@min-[760px]:grid-cols-3 md:@min-[1040px]:grid-cols-4">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex min-w-0 flex-col gap-5 rounded-panel border border-line/60 bg-panel p-6">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="size-12 shrink-0 rounded-full sm:size-14" />
          <div className="min-w-0 flex-1"><SkeletonBlock className="h-6 w-3/5" /><SkeletonBlock className="mt-2 h-4 w-4/5" /></div>
        </div>
        <SkeletonBlock className="h-4 w-20" />
        <div className="space-y-3"><SkeletonBlock className="h-4 w-full" /><SkeletonBlock className="h-4 w-full" /><SkeletonBlock className="h-4 w-2/3" /></div>
        <SkeletonBlock className="h-11 w-full rounded-control" />
      </div>)}
    </div>
  </SkeletonRegion>;
}
