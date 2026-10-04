import { z } from 'zod';
import { liveCouncilSchema, liveChatSchema } from './workspace.ts';
import type { chatInput } from './chat-agent.ts';
import type { councilInput } from './council-agent.ts';

type BackendSettings = { url: string; registrationKey: string };
// Tokens stay server-side and are isolated by the hosting-authenticated user.
// Backend sessions retain the same user and Twin across adapter restarts.
const identities = new Map<string, Promise<string>>();
async function runBackend<T>(schema: z.ZodType<T>, path: string, input: z.infer<typeof councilInput>, userId: string, settings: BackendSettings, signal: AbortSignal, providerFetch: typeof fetch = fetch, method = 'POST', payload: unknown = input) {
  const base = new URL(settings.url);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('INVALID_BACKEND_URL');
  if (base.username || base.password || base.search || base.hash) throw new Error('INVALID_BACKEND_URL');
  const identityKey = `${base.href}:${settings.registrationKey}:${userId}`;
  const tokenForUser = () => {
    let pending = identities.get(identityKey);
    if (!pending) {
      pending = (async () => {
        const response = await providerFetch(new URL('/v1/users/session', base), {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'X-Nook-Registration-Key': settings.registrationKey },
          body: JSON.stringify({ displayName: input.profile.name, externalId: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([base.href, userId]))))).map(byte => byte.toString(16).padStart(2, '0')).join('') })
        });
        if (!response.ok) throw new Error(response.status === 429 ? 'RATE_LIMIT' : 'BACKEND_REGISTRATION_FAILED');
        return z.object({ token: z.string().min(1) }).parse(await response.json()).token;
      })();
      identities.set(identityKey, pending);
      pending.catch(() => { if (identities.get(identityKey) === pending) identities.delete(identityKey); });
    }
    return pending;
  };
  let token = await tokenForUser();
  const send = () => providerFetch(new URL(path, base), {
    method, signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: method === 'GET' ? undefined : JSON.stringify(payload)
  });
  let response = await send();
  if (response.status === 401) {
    identities.delete(identityKey);
    token = await tokenForUser();
    response = await send();
  }
  if (!response.ok) {
    if (response.status === 401) identities.delete(identityKey);
    const upstream = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    const codes: Record<string, string> = { agent_not_connected: 'AGENT_NOT_CONNECTED', recipient_ambiguous: 'RECIPIENT_AMBIGUOUS', model_unconfigured: 'PROVIDER_CONFIG', grounding_failed: 'GROUNDING_FAILED' };
    throw new Error(response.status === 429 ? 'RATE_LIMIT' : codes[upstream?.error?.code || ''] || 'BACKEND_ERROR');
  }
  return schema.parse(await response.json());
}

export async function runBackendCouncil(input: z.infer<typeof councilInput>, userId: string, settings: BackendSettings, signal: AbortSignal, providerFetch: typeof fetch = fetch) {
  return runBackend(liveCouncilSchema, '/v1/reflections', input, userId, settings, signal, providerFetch);
}
export async function runBackendChat(input: z.infer<typeof chatInput>, userId: string, settings: BackendSettings, signal: AbortSignal, providerFetch: typeof fetch = fetch) {
  return runBackend(liveChatSchema, '/v1/chat', input, userId, settings, signal, providerFetch);
}

const connectionSchema = z.object({ id: z.string().uuid(), phase: z.enum(['invited', 'active', 'revoked']), participants: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })), invitationToken: z.string().optional() });
const inboxSchema = z.array(z.object({ id: z.string().uuid(), senderId: z.string().uuid(), connectionId: z.string().uuid(), content: z.string(), kind: z.enum(['invitation', 'message']), createdAt: z.string() }));
export async function runBackendConnections(input: z.infer<typeof councilInput>, userId: string, settings: BackendSettings, signal: AbortSignal, action: 'list' | 'invite' | 'accept' | 'inbox', invitationToken?: string) {
  if (action === 'list') return runBackend(z.array(connectionSchema), '/v1/connections', input, userId, settings, signal, fetch, 'GET');
  if (action === 'inbox') return runBackend(inboxSchema, '/v1/agent/messages', input, userId, settings, signal, fetch, 'GET');
  return runBackend(connectionSchema, action === 'invite' ? '/v1/connections/invitations' : '/v1/connections/accept', input, userId, settings, signal, fetch, 'POST', action === 'invite' ? {} : { invitationToken });
}
