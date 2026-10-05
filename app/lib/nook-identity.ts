// Anonymous visitors get separate, unguessable browser identities. Backend
// bearer tokens remain on the server, just as they do for signed-in users.
export type NookIdentity = { userId: string; cookie?: string };
export function resolveNookIdentity(request: Request, authenticatedId?: string | null): NookIdentity {
  if (authenticatedId) return { userId: authenticatedId };
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-nook-visitor' : 'nook-visitor';
  const cookies = (request.headers.get('cookie') || '').split(';').map(value => value.trim());
  const existing = cookies.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return { userId: `visitor:${existing}` };
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
  return {
    userId: `visitor:${token}`,
    cookie: `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`,
  };
}
export function identityHeaders(identity: NookIdentity, base: HeadersInit): Headers {
  const headers = new Headers(base);
  if (identity.cookie) headers.append('Set-Cookie', identity.cookie);
  return headers;
}
