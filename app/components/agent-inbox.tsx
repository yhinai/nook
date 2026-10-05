"use client";
import { useRef, useState } from 'react';
import { MessageCircle, Send, RefreshCw } from 'lucide-react';
import { connectionRequest } from '@/lib/connection-client';
import type { AgentMessage, Profile, TwinConnection } from '@/lib/workspace';

export function AgentInbox({ messages, connections, profile, loading, error, refresh }: { messages: AgentMessage[]; connections: TwinConnection[]; profile: Profile; loading: boolean; error: string; refresh: () => Promise<void> }) {
  const [replyTo, setReplyTo] = useState<AgentMessage | null>(null);
  const [selectedConnection, setSelectedConnection] = useState("");
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const request = useRef<{ text: string; connection: string; id: string } | null>(null);
  const activeConnections = connections.filter(connection => connection.phase === 'active');
  const targetConnection = replyTo?.connectionId || selectedConnection;
  const targetName = replyTo?.senderName || activeConnections.find(connection => connection.id === targetConnection)?.participants.find(person => !person.isMe)?.displayName || 'their';
  const send = async () => {
    if (!targetConnection || !reply.trim() || sending) return;
    if (!request.current || request.current.text !== reply.trim() || request.current.connection !== targetConnection) request.current = { text: reply.trim(), connection: targetConnection, id: crypto.randomUUID() };
    setSending(true); setFeedback('');
    try {
      await connectionRequest({ name: profile.name, priority: profile.priority, values: profile.values, weekend: profile.weekend, about: profile.about }, 'send', { connectionId: targetConnection, content: request.current.text, requestId: request.current.id });
      setFeedback(`${replyTo ? "Reply" : "Message"} delivered to ${targetName}’s Twin inbox.`); setReply(''); setReplyTo(null); request.current = null;
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not send your reply.'); }
    finally { setSending(false); }
  };
  return <section className="agent-inbox" aria-labelledby="agent-inbox-title">
    <div className="team-section-heading"><h3 id="agent-inbox-title"><MessageCircle size={16} /> Twin inbox</h3><button type="button" className="text-button" disabled={loading} onClick={() => void refresh()} aria-label="Refresh Twin inbox"><RefreshCw size={14} />{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {error && <p className="council-error" role="alert">{error}</p>}
    {!messages.length && <p className="subtle">{loading ? 'Checking for messages…' : 'Invitations and messages from connected Twins appear here.'}</p>}
    {messages.map(message => <article className="agent-inbox-message" key={message.id}>
      <div><strong>{message.senderName}’s Twin</strong><span>{message.kind === 'invitation' ? 'Invitation' : 'Message'} · <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></span></div>
      <p>{message.content}</p>
      <button type="button" className="text-button" disabled={sending || !connections.some(connection => connection.id === message.connectionId && connection.phase === 'active')} onClick={() => { setReplyTo(message); setReply(''); setFeedback(''); }}>Reply to {message.senderName}</button>
    </article>)}
    {activeConnections.length > 0 && <form onSubmit={event => { event.preventDefault(); void send(); }}>
      {replyTo ? <label className="field-label" htmlFor="twin-reply">Reply to {replyTo.senderName}</label> : <><label className="field-label" htmlFor="twin-recipient">Message a connected Twin</label><select id="twin-recipient" value={selectedConnection} onChange={event => { setSelectedConnection(event.target.value); setFeedback(''); }} required><option value="">Choose a person</option>{activeConnections.map(connection => <option value={connection.id} key={connection.id}>{connection.participants.find(person => !person.isMe)?.displayName}’s Twin</option>)}</select><label className="field-label" htmlFor="twin-reply">Your message</label></>}
      <textarea id="twin-reply" value={reply} disabled={sending} onChange={event => setReply(event.target.value)} rows={3} maxLength={1000} required />
      <div className="form-actions"><button type="button" className="text-button" disabled={sending} onClick={() => setReplyTo(null)}>Cancel</button><button className="primary-button" disabled={sending || !targetConnection || !reply.trim()}><Send size={14} />{sending ? 'Sending…' : replyTo ? 'Send reply' : 'Send message'}</button></div>
    </form>}
    {feedback && <p role="status" className="preview-note">{feedback}</p>}
  </section>;
}
