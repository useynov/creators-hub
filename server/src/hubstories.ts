// The Hub's stories: its own news channel at the top of Home. The team posts them on the admin
// site (announcements, events, new tasks, new merch, winners); creators tap through them like
// Instagram stories. Each has a photo or a flat colour, a headline, a short text and one button
// into the app, and stays up until its last day.
//
// Not to be confused with a creator's Instagram story sent in for a task (pipeline.ts, /api/stories).

import type { DB, HubStoryRow } from './db.js';
import { now } from './db.js';
import { HubError } from './errors.js';
import { localDate } from './service.js';
import { isTeam } from './team.js';
import type { HubStoryView } from './types.js';

/** Screens of the mini app a story's button may open. */
export const STORY_PATH = /^\/(tasks|events|shop|wallet|leaderboard|levels|profile)(\/[a-z0-9][a-z0-9-]{0,63})?$/;

export const isLive = (row: Pick<HubStoryRow, 'status' | 'ends_on'>, today = localDate()): boolean =>
  row.status === 'live' && (!row.ends_on || row.ends_on >= today);

function view(row: HubStoryRow & { seen: number }): HubStoryView {
  return {
    id: row.id,
    label: row.label,
    kicker: row.kicker,
    headline: row.headline,
    body: row.body,
    imageUrl: row.image_url,
    tone: row.tone === 'red' ? 'red' : 'dark',
    button: row.button_label && row.button_path ? { label: row.button_label, path: row.button_path } : null,
    publishedAt: row.published_at ?? row.created_at,
    seen: Boolean(row.seen),
  };
}

const SEEN = 'EXISTS (SELECT 1 FROM hub_story_views v WHERE v.story_id = s.id AND v.user_id = @userId) AS seen';

/** The stories that are up now: the ones this creator has not opened first, then the newest. */
export function liveStories(db: DB, userId: number): HubStoryView[] {
  const rows = db
    .prepare(
      `SELECT s.*, ${SEEN} FROM hub_stories s
       WHERE s.status = 'live' AND (s.ends_on IS NULL OR s.ends_on >= @today)
       ORDER BY seen ASC, COALESCE(s.published_at, s.created_at) DESC, s.id DESC`,
    )
    .all({ userId, today: localDate() }) as Array<HubStoryRow & { seen: number }>;
  return rows.map(view);
}

/** One story for the team to check before it goes up: a draft or an ended one opens too. */
export function previewStory(db: DB, userId: number, id: number): HubStoryView[] {
  if (!isTeam(db, userId)) return liveStories(db, userId);
  const row = db.prepare(`SELECT s.*, ${SEEN} FROM hub_stories s WHERE s.id = @id`).get({ userId, id }) as (HubStoryRow & { seen: number }) | undefined;
  if (!row) throw new HubError('story_not_found', 'This story does not exist.', 404);
  return [view(row)];
}

/** The creator opened a story: its ring on Home turns grey. */
export function markStorySeen(db: DB, userId: number, id: number): void {
  const row = db.prepare('SELECT status, ends_on FROM hub_stories WHERE id = ?').get(id) as Pick<HubStoryRow, 'status' | 'ends_on'> | undefined;
  // A draft opened in preview is not "seen": the count on the admin site is about creators.
  if (!row || !isLive(row)) return;
  db.prepare('INSERT OR IGNORE INTO hub_story_views (user_id, story_id, seen_at) VALUES (?, ?, ?)').run(userId, id, now());
}
