// A single-process guard for personal/local use. Hosted multi-instance deployment
// must replace this with a durable per-user budget before widening access.
export function createRequestBudget(limit = 10, windowMs = 60 * 60 * 1000) {
  const users = new Map<string, { used: number; pending: number; resetAt: number }>();
  return function acquire(userId: string, now = Date.now()): (() => void) | null {
    for (const [id, entry] of users) if (entry.resetAt <= now && !entry.pending) users.delete(id);
    let entry = users.get(userId);
    if (!entry) { if (users.size >= 1000) return null; entry = { used: 0, pending: 0, resetAt: now + windowMs }; users.set(userId, entry); }
    if (entry.pending || entry.used >= limit) return null;
    entry.used++; entry.pending++;
    let released = false;
    return () => { if (!released) { entry.pending--; released = true; } };
  };
}
export const acquireCouncilBudget = createRequestBudget();
