// From a submitted link to numbers in the report: one row in `publications` per link,
// automatic checks, and four measurements in `snapshots` (at submission, after 24 hours,
// after 7 days, final after 14 days).
//
// OWNERSHIP: the creator workstream owns this file and fills in the functions that throw
// below. The admin workstream only CALLS what is exported here and must not edit this
// file. The signatures are a contract: do not change them without updating docs/V2-SPEC.md.

import type { DB, PublicationRow, SnapshotRow } from './db.js';

export function publicationsOf(db: DB, entryId: number): PublicationRow[] {
  return db.prepare('SELECT * FROM publications WHERE entry_id = ? AND removed_at IS NULL ORDER BY id').all(entryId) as PublicationRow[];
}

export function publicationsOfTask(db: DB, taskId: string): PublicationRow[] {
  return db.prepare('SELECT * FROM publications WHERE task_id = ? AND removed_at IS NULL ORDER BY id').all(taskId) as PublicationRow[];
}

export function snapshotsOf(db: DB, publicationId: number): SnapshotRow[] {
  return db.prepare('SELECT * FROM snapshots WHERE publication_id = ? ORDER BY due_at').all(publicationId) as SnapshotRow[];
}

/**
 * Reads the publication again right now and stores what it finds: runs the checks again and
 * updates the current numbers. Does not add a snapshot. For the "refresh" button in the admin.
 */
export async function recheckPublication(_db: DB, _publicationId: number): Promise<PublicationRow> {
  throw new Error('recheckPublication: not built yet (creator workstream)');
}

/**
 * Takes every measurement that is due at `nowIso` (default: now). Safe to call twice.
 * Returns how many were taken. Called by the timer in jobs.ts, and by tests.
 */
export async function runDueSnapshots(_db: DB, _nowIso?: string): Promise<number> {
  throw new Error('runDueSnapshots: not built yet (creator workstream)');
}

/**
 * Stores the number of story views. `by` says who gave the number: the creator (with a
 * screenshot kept in the private media zone) or a team member correcting it in the admin.
 * Marks the publication's views_source as 'creator', makes the number final and updates
 * the entry's total views.
 */
export function setStoryViews(
  _db: DB,
  _publicationId: number,
  _views: number,
  _by: { kind: 'creator' } | { kind: 'team'; id: number },
  _screenshotPath?: string | null,
): PublicationRow {
  throw new Error('setStoryViews: not built yet (creator workstream)');
}
