import type { DirectoryTwin } from './workspace.ts';

export type UserFilter = 'all' | 'connected' | 'requests';
export function normalizeUserName(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
export function matchesUserName(name: string, query: string): boolean {
  const normalized = normalizeUserName(name);
  return normalizeUserName(query).split(' ').filter(Boolean).every(word => normalized.includes(word));
}
export function searchUsers(twins: DirectoryTwin[], query: string, filter: UserFilter): DirectoryTwin[] {
  const term = normalizeUserName(query);
  const rank = (name: string) => normalizeUserName(name) === term ? 0 : normalizeUserName(name).startsWith(term) ? 1 : 2;
  return twins.filter(twin => matchesUserName(twin.displayName, query) && (filter === 'all' || (filter === 'connected' && twin.status === 'connected') || (filter === 'requests' && (twin.status === 'incoming' || twin.status === 'outgoing')))).sort((a, b) => rank(a.displayName) - rank(b.displayName) || a.displayName.localeCompare(b.displayName));
}
