'use client';

import { useEffect, useRef } from 'react';
import { Room, RoomEvent, ParticipantKind, type RemoteParticipant } from 'livekit-client';
import { useViewport } from '@/components/use-viewport';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createLiveChatStore, liveChatSelectors, liveChatTopic, liveChatMaxLength } from '@/stores/live/chat';
import { useStoreInstance } from '@/stores/use-store-instance';
import { LiveIcon } from './live-icon';
import { LiveChatLoading } from './live-room-loading';

export function LiveChat({ room, connected, nickname, visible, assistantOnline = false, pending = false }: { assistantOnline?: boolean; pending?: boolean; room: Room | null; connected: boolean; nickname: string; visible: boolean }) {
  const viewport = useViewport();
  const ui = useStoreInstance(createLiveChatStore);
  const { messages, draft, sending, error, unread } = useStore(ui, useShallow(liveChatSelectors.view));
  const { setDraft, mentionAssistant, markRead, receivePayload, sendMessage, resetSession } = ui.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    resetSession();
    stickToBottom.current = true;
    if (!room) return;
    const receive = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== liveChatTopic || !participant) return;
      receivePayload(payload, { identity: participant.identity, name: participant.name || '观众', assistant: participant.kind === ParticipantKind.AGENT }, !stickToBottom.current);
    };
    // Signal that this browser can verify the Agent identity. LiveKit may deliver
    // data before batched member updates; the worker replays those same IDs.
    const ready = (participant: RemoteParticipant) => {
      if (participant.kind === ParticipantKind.AGENT) void room.localParticipant.publishData(new Uint8Array(), { reliable: true, topic: 'room-assistant.ready.v1', destinationIdentities: [participant.identity] }).catch(() => {});
    };
    const readyAll = () => room.remoteParticipants.forEach(ready);
    room.on(RoomEvent.DataReceived, receive);
    room.on(RoomEvent.ParticipantConnected, ready).on(RoomEvent.Reconnected, readyAll);
    readyAll();
    return () => { room.off(RoomEvent.DataReceived, receive).off(RoomEvent.ParticipantConnected, ready).off(RoomEvent.Reconnected, readyAll); resetSession(); };
  }, [room, resetSession, receivePayload]);

  useEffect(() => {
    let frame = 0;
    const unsubscribe = ui.subscribe(s => s.messages, (next, previous) => {
      if (next !== previous && next.at(-1)?.own) stickToBottom.current = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (visible && stickToBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }, { fireImmediately: true });
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [ui, visible]);

  async function send() {
    if (!room || !connected) return;
    const author = { identity: room.localParticipant.identity, name: room.localParticipant.name || nickname };
    const sent = await sendMessage(author, payload => room.localParticipant.publishData(payload, { reliable: true, topic: liveChatTopic }));
    if (sent) inputRef.current?.focus();
  }

  if (pending) return <LiveChatLoading />;

  return <div className="live-chat">
    <div className="live-chat-log" ref={scrollRef} role="log" aria-label="直播间消息" aria-live="polite" aria-relevant="additions" onScroll={() => {
      const element = scrollRef.current;
      if (!element) return;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      if (stickToBottom.current) markRead();
    }}>
      {messages.length === 0 && <div className="live-chat-empty"><p>{connected ? '暂无消息' : '连接后即可聊天'}</p></div>}
      {messages.map((message) => <div key={message.id} className={`live-message ${message.own ? 'is-own' : ''}`}>
        <span className="live-message-avatar">{message.name.slice(0, 1)}</span>
        <div className="live-message-body"><div className="live-message-meta"><strong>{message.name}</strong>{message.assistant && <span className="live-message-role">AI 助手</span>}{message.host && <span className="live-message-role">主播</span>}{message.own && <span>我</span>}<time dateTime={new Date(message.time).toISOString()}>{new Date(message.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></div>
      </div>)}
    </div>
    {unread > 0 && <button type="button" className="live-unread" onClick={() => { stickToBottom.current = true; markRead(); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}>{unread} 条新消息 ↓</button>}
    <form className="live-chat-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error && <p role="alert" className="live-form-error">{error}</p>}
      <div className="live-chat-compose">
      <label className="sr-only" htmlFor="live-message">发送消息</label>
      <textarea id="live-message" title={viewport === 'mobile' ? '消息仅在本次直播中显示。回车换行，点击发送。' : '消息仅在本次直播中显示。Enter 发送，Shift + Enter 换行。'} ref={inputRef} maxLength={liveChatMaxLength} rows={1} disabled={!connected || sending} placeholder={connected ? '说点什么…' : '连接后即可发送消息'} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (viewport === 'desktop' && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
      }} />
      <div className="live-chat-form-footer">{assistantOnline && <button type="button" className="min-h-11 min-w-11 rounded-control px-2 text-sm text-muted hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-2" aria-label="向 AI 助手提问" disabled={!connected || sending} onClick={() => { mentionAssistant(); inputRef.current?.focus(); }}>@AI</button>}<span data-near-limit={draft.length >= liveChatMaxLength - 100 || undefined}>{draft.length ? `${draft.length}/${liveChatMaxLength}` : null}</span><button type="submit" className="live-button live-button-primary" disabled={!connected || !draft.trim() || sending}><LiveIcon name="send" size={17} /><span className="max-md:sr-only">{sending ? '发送中…' : '发送'}</span></button></div>
      </div>
    </form>
  </div>;
}
