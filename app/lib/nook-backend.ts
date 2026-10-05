import { z } from 'zod';
import { directoryTwinSchema, liveCouncilSchema, liveChatSchema, connectionViewSchema, agentInboxSchema } from './workspace.ts';
import type { chatInput } from './chat-agent.ts';
import type { councilInput } from './council-agent.ts';

type BackendSettings = { url: string; registrationKey: string };
// Tokens stay server-side and are isolated by the hosting-authenticated user.
// Backend sessions retain the same user and Twin across adapter restarts.
const identities = new Map<string, string>();
async function runBackend<T>(schema: z.ZodType<T>, path: string, input: z.infer<typeof councilInput>, userId: string, settings: BackendSettings, signal: AbortSignal, providerFetch: typeof fetch = fetch, method = 'POST', payload: unknown = input) {
  const base = new URL(settings.url);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('INVALID_BACKEND_URL');
  if (base.username || base.password || base.search || base.hash) throw new Error('INVALID_BACKEND_URL');
  // Registration requests use their own signal: cancelling one browser request
  // must not invalidate another request waiting for the same account.
  const identityKey = JSON.stringify([base.origin, userId, input.profile.name, settings.registrationKey]);
  const tokenForUser = async () => {
    const cached = identities.get(identityKey);
    if (cached) return cached;
    const canonicalBase = new URL('/', base).href;
    const externalId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([canonicalBase, userId]))))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await providerFetch(new URL('/v1/users/session', base), {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Nook-Registration-Key': settings.registrationKey },
      body: JSON.stringify({ displayName: input.profile.name, externalId })
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'RATE_LIMIT' : 'BACKEND_REGISTRATION_FAILED');
    const token = z.object({ token: z.string().min(1) }).parse(await response.json()).token;
    if (identities.size >= 1000) identities.delete(identities.keys().next().value!);
    identities.set(identityKey, token);
    return token;
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
    const codes: Record<string, string> = { request_recipient_only: 'REQUEST_RECIPIENT_ONLY', agent_not_connected: 'AGENT_NOT_CONNECTED', recipient_ambiguous: 'RECIPIENT_AMBIGUOUS', model_unconfigured: 'PROVIDER_CONFIG', grounding_failed: 'GROUNDING_FAILED', invitation_invalid: 'INVITATION_INVALID', self_connection: 'SELF_CONNECTION', connection_inactive: 'CONNECTION_INACTIVE', request_conflict: 'REQUEST_CONFLICT', multiple_recipients: 'MULTIPLE_RECIPIENTS', already_running: 'ALREADY_RUNNING', provider_quota: 'PROVIDER_QUOTA', provider_config: 'PROVIDER_CONFIG', provider_busy: 'RATE_LIMIT', model_invalid_response: 'INVALID_RESPONSE' };
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

export async function runBackendConnections(input: z.infer<typeof councilInput>, userId: string, settings: BackendSettings, signal: AbortSignal, action: 'list' | 'invite' | 'accept' | 'inbox' | 'send' | 'directory' | 'request' | 'respond', payload?: string | Record<string, string>, providerFetch: typeof fetch = fetch) {
  if (action === 'directory') return runBackend(directoryTwinSchema.array(), '/v1/twins', input, userId, settings, signal, providerFetch, 'GET');
  if (action === 'request' || action === 'respond') return runBackend(connectionViewSchema, action === 'request' ? '/v1/connections/requests' : '/v1/connections/respond', input, userId, settings, signal, providerFetch, 'POST', payload);
  if (action === 'list') return runBackend(connectionViewSchema.array(), '/v1/connections', input, userId, settings, signal, providerFetch, 'GET');
  if (action === 'inbox') return runBackend(agentInboxSchema, '/v1/agent/messages', input, userId, settings, signal, providerFetch, 'GET');
  if (action === 'send') return runBackend(z.object({ id: z.string().uuid(), status: z.literal('delivered') }), '/v1/agent/messages', input, userId, settings, signal, providerFetch, 'POST', payload);
  return runBackend(connectionViewSchema, action === 'invite' ? '/v1/connections/invitations' : '/v1/connections/accept', input, userId, settings, signal, providerFetch, 'POST', action === 'invite' ? {} : { invitationToken: payload });
}
