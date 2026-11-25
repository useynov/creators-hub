// A team member's own creator account, wiped, so they can walk the creator's path again
// from the first screen: welcome, age, Instagram, the team's confirmation.
//
// Only the creator side goes: tasks joined, publications and their numbers, coins, orders,
// payout requests, RSVPs, the Instagram link, personal details. The team role, the tasks and
// shop items this person created, their sign-ins to the admin site and everything about other
// creators stay as they are.

import { unlink } from 'node:fs/promises';
import type { DB } from './db.js';
import { mediaFile } from './media.js';
import { balanceOf, getUser } from './service.js';

export interface StartOverCount {
  tasks: number;
  publications: number;
  coins: number;
  orders: number;
  cashouts: number;
  rsvps: number;
}

const count = (db: DB, table: string, userId: number): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;

/** What starting over would remove. null when this person has no creator account. */
export function startOverPreview(db: DB, userId: number): StartOverCount | null {
  if (!getUser(db, userId)) return null;
  return {
    tasks: count(db, 'entries', userId),
    publications: count(db, 'publications', userId),
    coins: balanceOf(db, userId),
    orders: count(db, 'orders', userId),
    cashouts: count(db, 'cashouts', userId),
    rsvps: count(db, 'rsvps', userId),
  };
}

/** Removes the creator account for good. Returns what was removed, or null when there was no account. */
export async function startOver(db: DB, userId: number): Promise<StartOverCount | null> {
  const removed = startOverPreview(db, userId);
  if (!removed) return null;

  // Files that belong to this account only: the avatar, story copies, thumbnails, screenshots.
  const files: Array<['public' | 'private', string]> = [];
  const avatars = db
    .prepare(
      `SELECT avatar_url AS url FROM users WHERE id = @id AND avatar_url IS NOT NULL
       UNION SELECT avatar_url FROM social_profiles WHERE user_id = @id AND avatar_url IS NOT NULL`,
    )
    .all({ id: userId }) as Array<{ url: string }>;
  for (const { url } of avatars) {
    const shared = db
      .prepare(
        `SELECT 1 FROM users WHERE avatar_url = @url AND id <> @id
         UNION SELECT 1 FROM social_profiles WHERE avatar_url = @url AND user_id <> @id`,
      )
      .get({ url, id: userId });
    if (!shared && url.startsWith('/media/avatars/')) files.push(['public', url.slice('/media/'.length)]);
  }
  const publications = db
    .prepare('SELECT thumb_path, media_path, story_screenshot_path FROM publications WHERE user_id = ?')
    .all(userId) as Array<{ thumb_path: string | null; media_path: string | null; story_screenshot_path: string | null }>;
  for (const row of publications) {
    if (row.thumb_path) files.push(['public', row.thumb_path]);
    if (row.media_path) files.push(['private', row.media_path]);
    if (row.story_screenshot_path) files.push(['private', row.story_screenshot_path]);
  }

  db.transaction(() => {
    // An order that was never delivered gives its item back to the shelf.
    db.prepare(
      `UPDATE shop_items SET stock = stock + (SELECT COUNT(*) FROM orders o
         WHERE o.item_id = shop_items.id AND o.user_id = @id AND o.status IN ('new', 'packed', 'shipped'))
       WHERE stock IS NOT NULL AND id IN (SELECT item_id FROM orders WHERE user_id = @id)`,
    ).run({ id: userId });
    // A reply the team was still writing about this account or its work has nothing to land on.
    db.prepare(
      `DELETE FROM admin_pending WHERE (kind = 'account' AND entry_id = @id)
         OR (kind = 'entry' AND entry_id IN (SELECT id FROM entries WHERE user_id = @id))`,
    ).run({ id: userId });
    db.prepare('DELETE FROM snapshots WHERE publication_id IN (SELECT id FROM publications WHERE user_id = ?)').run(userId);
    for (const table of [
      'publications',
      'submissions',
      'entries',
      'ledger',
      'orders',
      'cashouts',
      'rsvps',
      'reminders',
      'offers',
      'support_threads',
      'user_tags',
      'social_profiles',
      'social_lookups',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM age_refusals WHERE telegram_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();

  for (const [zone, path] of files) {
    const file = mediaFile(zone, path);
    if (file) await unlink(file).catch(() => undefined);
  }
  return removed;
}
