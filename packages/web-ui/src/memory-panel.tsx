'use client';

export type MemoryRow = { id: string; content: string; kind: string; sourceMessageId: string; manual: boolean; reason?: string; validUntil?: string | null; assertion?: string };
export type MemoryPanelProps = {
  enabled: boolean; loading: boolean; loadError: string; busy: string | null; error: string; notice: string;
  items: MemoryRow[]; proposals: MemoryRow[]; draft: { id: string; content: string } | null; confirming: boolean;
  onEnabled: (value: boolean) => void; onRetry: () => void; onEdit: (id: string) => void; onDraft: (value: string) => void;
  onSave: () => void; onCancel: () => void; onDelete: (id: string) => void; onResolve: (id: string, accept: boolean) => void;
  onClear: () => void; onConfirm: () => void;
  hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void;
};
const action = 'min-h-11 rounded px-2 text-sm text-muted hover:bg-surface-soft hover:text-ink focus-visible:outline disabled:opacity-40';
export function MemoryPanelBody(p: MemoryPanelProps) {
  if (p.loading) return <p role="status" className="py-4 text-sm text-muted">正在读取记忆…</p>;
  if (p.loadError) return <div role="alert" className="text-sm"><p>{p.loadError}</p><button className={action} onClick={p.onRetry}>重新加载记忆</button></div>;
  const row = (m: MemoryRow, proposal = false) => <li key={m.id} className="border-b border-line py-3 last:border-0">
    {p.draft?.id === m.id ? <form onSubmit={e => { e.preventDefault(); p.onSave(); }}>
      <label className="block text-sm">编辑记忆<textarea autoFocus value={p.draft.content} onChange={e => p.onDraft(e.target.value)} maxLength={300} disabled={!!p.busy} rows={3} className="mt-2 block w-full resize-y rounded border border-line bg-canvas px-3 py-2 text-base text-ink focus-visible:outline" /></label>
      <div className="mt-2 flex gap-2"><button className={action} disabled={!!p.busy}>{p.busy === m.id ? '保存中…' : '保存记忆'}</button><button type="button" onClick={p.onCancel} className={action} disabled={!!p.busy}>取消编辑</button></div>
    </form> : <>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{m.assertion === 'PLAN' && <span className="mr-2 text-xs text-muted">计划</span>}{m.content}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{proposal ? m.reason || '需要你确认' : m.manual ? '由你确认或编辑' : '来自你的明确陈述'} · 来源消息 {m.sourceMessageId}{m.validUntil ? ` · 有效至 ${m.validUntil.slice(0, 10)}` : ''}</p>
      <div className="flex flex-wrap gap-1">{proposal ? <><button className={action} disabled={!!p.busy || !p.enabled} onClick={() => p.onResolve(m.id, true)}>记住</button><button className={action} disabled={!!p.busy} onClick={() => p.onResolve(m.id, false)}>不记住</button></> : <><button className={action} disabled={!!p.busy || !p.enabled} onClick={() => p.onEdit(m.id)}>编辑</button><button className={action} disabled={!!p.busy} onClick={() => p.onDelete(m.id)}>删除</button></>}</div>
    </>}
  </li>;
  return <div className="space-y-4">
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium"><span>自动记住这段聊天</span><input type="checkbox" checked={p.enabled} disabled={!!p.busy} onChange={e => p.onEnabled(e.target.checked)} className="size-5 accent-action" /></label>
    <p className="text-xs leading-5 text-muted">开启即同意从这段历史和后续聊天中整理记忆，相关内容会交给模型处理。明确事实自动保存，其余内容由你确认。不同陪伴角色不共享记忆。</p>
    {!p.enabled && <p className="text-sm leading-6 text-muted">已停止记忆整理和回忆。已有记忆仍可查看、删除。</p>}
    {p.error && <p role="alert" className="text-sm text-danger">{p.error}</p>}
    {p.notice && <p role="status" className="text-sm text-muted">{p.notice}</p>}
    {p.confirming && <div role="group" aria-label="确认删除记忆" className="rounded border border-line bg-canvas p-3"><p className="text-sm leading-6">删除后不再用于回忆，也不会从旧聊天自动记回。聊天记录会保留。</p><div className="mt-2 flex gap-2"><button className={action} disabled={!!p.busy} onClick={p.onConfirm}>{p.busy ? '处理中…' : '确认删除'}</button><button className={action} disabled={!!p.busy} onClick={p.onCancel}>取消</button></div></div>}
    <section aria-label="已记住"><h4 className="text-sm font-medium">已记住</h4>{p.items.length ? <ul>{p.items.map(m => row(m))}</ul> : <p className="py-3 text-sm text-muted">还没有保存的记忆。</p>}</section>
    {!!p.proposals.length && <section aria-label="待确认"><h4 className="text-sm font-medium">待确认</h4><ul>{p.proposals.map(m => row(m, true))}</ul></section>}
    {p.hasMore && <button className={action} disabled={!!p.busy || p.loadingMore} onClick={p.onLoadMore}>{p.loadingMore ? '加载中…' : '加载更多记忆'}</button>}
    {!!(p.items.length || p.proposals.length) && <button className={action} disabled={!!p.busy} onClick={p.onClear}>清空全部记忆</button>}
  </div>;
}
