import type { LiveAssistantState } from '@my-platform/shared';
import { LiveIcon } from './live-icon';

export function LiveAssistantControls({ assistant, connected, busy, onCall, onRemove }: {
  assistant: LiveAssistantState; connected: boolean; busy: boolean;
  onCall: () => Promise<void>; onRemove: () => Promise<void>;
}) {
  const active = ['starting', 'online', 'stopping'].includes(assistant.status);
  return <div className="flex flex-wrap items-center gap-3" aria-label="AI 助手控制">
    {active ? <>
      <span role="status" className="flex items-center gap-2 text-sm text-muted"><LiveIcon name="robot" size={16} />{assistant.status === 'online' ? 'AI 助手已在线' : assistant.status === 'stopping' ? '助手退出中…' : '等待助手加入…'}</span>
      <button type="button" className="live-agent-button" disabled={!connected || busy} onClick={() => void onRemove()}>{busy ? '处理中…' : assistant.status === 'starting' ? '取消呼叫' : assistant.status === 'stopping' ? '重试移除' : '移除助手'}</button>
    </> : <button type="button" className="live-agent-button" disabled={!connected || busy} onClick={() => void onCall()}><LiveIcon name="robot" size={16} />{busy ? '呼叫中…' : assistant.status === 'failed' ? '重新呼叫 AI 助手' : '呼叫 AI 助手'}</button>}
    {assistant.error && <p role="status" className="basis-full text-sm text-muted">{assistant.error}</p>}
  </div>;
}
