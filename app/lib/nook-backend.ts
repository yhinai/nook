import { z } from 'zod';
import { liveCouncilSchema } from './workspace.ts';
import type { councilInput } from './council-agent.ts';

type BackendSettings = { url: string; registrationKey: string };
// Tokens stay server-side and are isolated by the hosting-authenticated user.
// Restarting this adapter creates a fresh backend identity; no existing user's
// persistent backend profile or memory is modified by the frontend preview.
const identities = new Map<string, Promise<string>>();
export async function runBackendCouncil(input: z.infer<typeof councilInput>, userId: string, settings: BackendSettings, signal: AbortSignal, providerFetch: typeof fetch = fetch) {
  const base = new URL(settings.url);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('INVALID_BACKEND_URL');
  if (base.username || base.password || base.search || base.hash) throw new Error('INVALID_BACKEND_URL');
  const identityKey = `${base.origin}:${userId}`;
  const tokenForUser = () => {
    let pending = identities.get(identityKey);
    if (!pending) {
      pending = (async () => {
        const response = await providerFetch(new URL('/v1/users', base), {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'X-Nook-Registration-Key': settings.registrationKey },
          body: JSON.stringify({ displayName: input.profile.name })
        });
        if (!response.ok) throw new Error('BACKEND_REGISTRATION_FAILED');
        return z.object({ token: z.string().min(1) }).parse(await response.json()).token;
      })();
      identities.set(identityKey, pending);
      pending.catch(() => { if (identities.get(identityKey) === pending) identities.delete(identityKey); });
    }
    return pending;
  };
  const token = await tokenForUser();
  const response = await providerFetch(new URL('/v1/reflections', base), {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    if (response.status === 401) identities.delete(identityKey);
    throw new Error(response.status === 429 ? 'RATE_LIMIT' : 'BACKEND_ERROR');
  }
  return liveCouncilSchema.parse(await response.json());
}
