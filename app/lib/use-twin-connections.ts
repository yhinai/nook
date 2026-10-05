"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectionRequest } from './connection-client';
import { directoryTwinSchema, agentInboxSchema, connectionViewSchema, type DirectoryTwin, type Profile, type TwinConnection, type AgentMessage } from './workspace';

export function useTwinConnections(profile: Profile, enabled: boolean) {
  const [directory, setDirectory] = useState<DirectoryTwin[]>([]);
  const [actionBusy, setActionBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const actionRunning = useRef(false);
  const [connections, setConnections] = useState<TwinConnection[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const running = useRef<AbortController | null>(null);
  const profileKey = JSON.stringify({ name: profile.name, priority: profile.priority, values: profile.values, weekend: profile.weekend, about: profile.about });
  const refresh = useCallback(async () => {
    if (!enabled || running.current) return;
    const controller = new AbortController(); running.current = controller;
    setLoading(true);
    try {
      const context = JSON.parse(profileKey);
      const [list, inbox, people] = await Promise.all([connectionRequest(context, 'list', {}, controller.signal), connectionRequest(context, 'inbox', {}, controller.signal), connectionRequest(context, 'directory', {}, controller.signal)]);
      if (controller.signal.aborted) return;
      setDirectory(directoryTwinSchema.array().parse(people));
      setConnections(connectionViewSchema.array().parse(list));
      setMessages(agentInboxSchema.parse(inbox)); setError('');
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not refresh your Circle.');
    } finally {
      if (running.current === controller) { running.current = null; setLoading(false); }
    }
  }, [profileKey, enabled]);
  const actOnTwin = async (twin: DirectoryTwin, decision?: 'accept' | 'decline') => {
    if (!enabled || actionRunning.current) return;
    actionRunning.current = true; setActionBusy(twin.id); setActionError('');
    try {
      await connectionRequest(JSON.parse(profileKey), decision ? 'respond' : 'request', decision ? { connectionId: twin.connectionId!, decision } : { recipientId: twin.id });
      running.current?.abort(); running.current = null;
      await refresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update this connection.'); }
    finally { actionRunning.current = false; setActionBusy(''); }
  };
  useEffect(() => {
    if (!enabled) return;
    const update = () => { if (document.visibilityState === 'visible') void refresh(); };
    const initial = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    return () => { clearTimeout(initial); clearInterval(timer); window.removeEventListener('focus', update); running.current?.abort(); running.current = null; };
  }, [enabled, refresh]);
  return { directory: enabled ? directory : [], actionBusy, actionError, actOnTwin, connections: enabled ? connections : [], messages: enabled ? messages : [], error: enabled ? error : '', loading, refresh };
}
