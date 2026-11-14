// Pure ticket rules: no Nest, no database, so they are cheap to unit test.

export const ROLES = ['requester', 'agent', 'admin'] as const;
export const CATEGORIES = ['hardware', 'software', 'network', 'account', 'printer', 'other'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;

export type Role = (typeof ROLES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];

/** Hours until a ticket breaches its SLA, by priority. */
export const SLA_HOURS: Record<Priority, number> = { urgent: 4, high: 8, medium: 24, low: 72 };

export function slaDueAt(priority: Priority, from: Date): Date {
  return new Date(from.getTime() + SLA_HOURS[priority] * 3_600_000);
}

export function isOverdue(t: { status: Status; slaDueAt: Date }, now = new Date()): boolean {
  return (t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting') && t.slaDueAt < now;
}

const FLOW: Record<Status, Status[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['waiting', 'resolved'],
  waiting: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

/**
 * Whether `role` may move a ticket from `from` to `to`.
 * Staff may make any move the flow allows. The person who opened the ticket may
 * only cancel it while it is still open, or, once it is resolved, confirm the fix
 * (close) or say it is not fixed (reopen).
 */
export function canTransition(from: Status, to: Status, role: Role, isRequester: boolean): boolean {
  if (!FLOW[from].includes(to)) return false;
  if (role === 'agent' || role === 'admin') return true;
  if (!isRequester) return false;
  return (from === 'open' && to === 'closed') || from === 'resolved';
}

export function nextStatuses(from: Status, role: Role, isRequester: boolean): Status[] {
  return FLOW[from].filter((to) => canTransition(from, to, role, isRequester));
}
