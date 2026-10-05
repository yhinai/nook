import { directoryTwinSchema, agentInboxSchema, connectionViewSchema, deliveryReceiptSchema, type Profile } from './workspace.ts';

export type ConnectionAction = 'list' | 'inbox' | 'invite' | 'accept' | 'send' | 'directory' | 'request' | 'respond';
export async function connectionRequest(profile: Pick<Profile, 'name' | 'priority' | 'values' | 'weekend' | 'about'>, action: ConnectionAction, payload: Record<string, string> = {}, signal?: AbortSignal, requestFetch: typeof fetch = fetch) {
  const response = await requestFetch('/api/connections', {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, action, ...payload }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Could not reach your Twin connections. Please try again.');
  if (action === 'directory') return directoryTwinSchema.array().parse(result);
  if (action === 'list') return connectionViewSchema.array().parse(result);
  if (action === 'inbox') return agentInboxSchema.parse(result);
  if (action === 'send') return deliveryReceiptSchema.parse(result);
  return connectionViewSchema.parse(result);
}
