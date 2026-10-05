'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, type RemoteParticipant } from 'livekit-client';
import { LiveIcon } from './live-icon';

const CHAT_TOPIC = 'live-chat.v1';
const MAX_LENGTH = 500;
const MAX_MESSAGES = 200;

type Message = { id: string; identity: string; name: string; host: boolean; text: string; time: number; own: boolean };

export function LiveChat({ room, connected, nickname, visible }: { room: Room | null; connected: boolean; nickname: string; visible: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const sendingRef = useRef(false);
  const sessionRef = useRef(room);

  useEffect(() => {
    sessionRef.current = room;
    setMessages([]);
    setUnread(0);
    setError('');
    stickToBottom.current = true;
    if (!room) return;
    const receive = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== CHAT_TOPIC || !participant || payload.byteLength > 4096) return;
      try {
        const data: unknown = JSON.parse(new TextDecoder().decode(payload));
        if (!data || typeof data !== 'object') return;
        const message = data as Record<string, unknown>;
        if (message.v !== 1 || typeof message.id !== 'string' || message.id.length > 80 || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_LENGTH) return;
        const id = `${participant.identity}:${message.id}`;
        const item: Message = { id, identity: participant.identity, name: participant.name || '观众', host: participant.identity.startsWith('host_'), text: message.text.trim(), time: Date.now(), own: false };
        setMessages((current) => current.some((entry) => entry.id === id) ? current : [...current, item].slice(-MAX_MESSAGES));
        if (!stickToBottom.current) setUnread((count) => count + 1);
      } catch {
        // Other participants may publish unrelated or malformed data.
      }
    };
    room.on(RoomEvent.DataReceived, receive);
    return () => { room.off(RoomEvent.DataReceived, receive); };
  }, [room]);

  useEffect(() => {
    if (visible && stickToBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, visible]);

  async function send() {
    const text = draft.trim();
    if (!room || !connected || !text || text.length > MAX_LENGTH || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    const id = crypto.randomUUID();
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ v: 1, id, text })), { reliable: true, topic: CHAT_TOPIC });
      if (sessionRef.current !== room) return;
      const identity = room.localParticipant.identity;
      stickToBottom.current = true;
      setUnread(0);
      setMessages((current) => [...current, { id: `${identity}:${id}`, identity, name: room.localParticipant.name || nickname, host: identity.startsWith('host_'), text, time: Date.now(), own: true }].slice(-MAX_MESSAGES));
      setDraft('');
      inputRef.current?.focus();
    } catch {
      if (sessionRef.current === room) setError('消息未发送，请检查连接后重试。');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return <div className="live-chat">
    <div className="live-chat-log" ref={scrollRef} role="log" aria-label="直播间消息" aria-live="polite" aria-relevant="additions" onScroll={() => {
      const element = scrollRef.current;
      if (!element) return;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      if (stickToBottom.current) setUnread(0);
    }}>
      <p className="live-chat-intro">欢迎来到直播间，和大家打个招呼吧。<span>消息实时显示，重新进入后不保留。</span></p>
      {messages.length === 0 && <div className="live-chat-empty"><LiveIcon name="chat" size={28} /><p>{connected ? '还没有消息，来说第一句吧' : '进入直播间后即可聊天'}</p></div>}
      {messages.map((message) => <div key={message.id} className={`live-message ${message.own ? 'is-own' : ''}`}>
        <span className="live-message-avatar">{message.name.slice(0, 1)}</span>
        <div className="live-message-body"><div className="live-message-meta"><strong>{message.name}</strong>{message.host && <span className="live-message-role">主播</span>}{message.own && <span>我</span>}<time dateTime={new Date(message.time).toISOString()}>{new Date(message.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></div>
      </div>)}
    </div>
    {unread > 0 && <button type="button" className="live-unread" onClick={() => { stickToBottom.current = true; setUnread(0); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}>{unread} 条新消息 ↓</button>}
    <form className="live-chat-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error && <p role="alert" className="live-form-error">{error}</p>}
      <label className="sr-only" htmlFor="live-message">发送消息</label>
      <textarea id="live-message" ref={inputRef} maxLength={MAX_LENGTH} rows={2} disabled={!connected || sending} placeholder={connected ? '说点什么…' : '连接后即可发送消息'} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
      }} />
      <div className="live-chat-form-footer"><span>{draft.length ? `${draft.length}/${MAX_LENGTH}` : 'Enter 发送 · Shift + Enter 换行'}</span><button type="submit" className="live-button live-button-primary" disabled={!connected || !draft.trim() || sending}><LiveIcon name="send" size={15} />{sending ? '发送中…' : '发送'}</button></div>
    </form>
  </div>;
}
