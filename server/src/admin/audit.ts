// Every change made on the admin site leaves a line in audit_log: who, what, on which
// record, and a short detail. Never secrets, never personal data (no addresses, phones,
// payout details, comments to creators): the detail is a status or a number.

import { now, type DB } from '../db.js';
import { HubError } from '../service.js';

export function audit(db: DB, actorId: number, action: string, target: string | number | null, detail?: string | null): void {
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    actorId,
    action.slice(0, 60),
    target === null ? null : String(target).slice(0, 80),
    detail ? detail.slice(0, 200) : null,
    now(),
  );
}

/**
 * Calls a function the creator workstream owns (refreshProfile, setAccountStatus,
 * recheckPublication, setStoryViews). Until those are built they throw "not built yet";
 * the site then shows a calm "not available yet" instead of breaking.
 * A HubError is a real answer (for example "not waiting for review") and passes through.
 */
export function creatorCall<T>(name: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw unavailable(name, error);
  }
}

export async function creatorCallAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw unavailable(name, error);
  }
}

function unavailable(name: string, error: unknown): HubError {
  if (error instanceof HubError) return error;
  // The function name and the error class are enough to find it; the message may carry data.
  console.error(`[admin] ${name} failed: ${(error as Error)?.name ?? 'Error'}`);
  return new HubError('not_ready', 'This action is not available yet. Please try again later.', 503);
}
