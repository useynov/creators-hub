// A creator's social accounts: the data we pull from their public profile, the team's
// confirmation that the account is really theirs, and the tags the team puts on them.
//
// OWNERSHIP: the creator workstream owns this file and fills in the two functions that
// throw below. The admin workstream only CALLS what is exported here and must not edit
// this file. The signatures are a contract: do not change them without updating
// docs/V2-SPEC.md.

import type { AudienceSubject } from './audience.js';
import type { AccountStatus, DB, Platform, SocialProfileRow, UserRow } from './db.js';
import type { Level } from './types.js';

export function profileOf(db: DB, userId: number, platform: Platform = 'instagram'): SocialProfileRow | undefined {
  return db.prepare('SELECT * FROM social_profiles WHERE user_id = ? AND platform = ?').get(userId, platform) as
    | SocialProfileRow
    | undefined;
}

export function tagsOf(db: DB, userId: number): string[] {
  return (db.prepare('SELECT tag FROM user_tags WHERE user_id = ? ORDER BY tag').all(userId) as Array<{ tag: string }>).map(
    (row) => row.tag,
  );
}

/** Replaces the creator's tags. Tags are trimmed, lower-cased, de-duplicated, at most 20 of 30 characters. */
export function setTags(db: DB, userId: number, tags: string[]): string[] {
  const clean = [...new Set(tags.map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20);
  db.transaction(() => {
    db.prepare('DELETE FROM user_tags WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO user_tags (user_id, tag) VALUES (?, ?)');
    for (const tag of clean) insert.run(userId, tag);
  })();
  return clean;
}

/** What the audience filter needs to know about one creator. */
export function audienceSubject(db: DB, user: UserRow, level: Level): AudienceSubject {
  return {
    id: user.id,
    city: user.city,
    level,
    followers: profileOf(db, user.id, 'instagram')?.followers ?? null,
    tags: tagsOf(db, user.id),
  };
}

/**
 * Reads the creator's public profile again and stores it (numbers, avatar, recent posts).
 * Returns the stored row, or null when the creator has no handle for that platform.
 * Never throws for provider trouble: the row's status says what happened.
 */
export async function refreshProfile(_db: DB, _userId: number, _platform: Platform = 'instagram'): Promise<SocialProfileRow | null> {
  throw new Error('refreshProfile: not built yet (creator workstream)');
}

/**
 * The team's decision on whether the account belongs to the creator.
 * Stores who decided and when, and tells the creator in the bot:
 *   confirmed: "Your account is confirmed", tasks pay out from now on
 *   rejected:  "We could not confirm your account", with the note and a button to change the handle
 *   pending:   silent (used when the creator changes their handle)
 * `by` is the Telegram id of the team member, or 0 for the system.
 */
export function setAccountStatus(_db: DB, _userId: number, _status: AccountStatus, _by: number, _note?: string | null): void {
  throw new Error('setAccountStatus: not built yet (creator workstream)');
}
