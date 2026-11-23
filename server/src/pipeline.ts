// From a submitted link to numbers in the report: one row in `publications` per link,
// automatic checks, and four measurements in `snapshots` (at submission, after 24 hours,
// after 7 days, final after 14 days).
//
// OWNERSHIP: the creator workstream owns this file and fills in the functions that throw
// below. The admin workstream only CALLS what is exported here and must not edit this
// file. The signatures are a contract: do not change them without updating docs/V2-SPEC.md.
//
// How a send goes:
//   1. submitLinks (service.ts) stores a `submissions` row in 'checking' and starts processSubmission.
//   2. processSubmission reads every link. A link from someone else's account BLOCKS the whole send:
//      nothing reaches the team and the creator sees whose post it is. Every other doubt is a flag.
//   3. Otherwise the entry goes to review, each link becomes a publication with its checks and the
//      first measurement, the three follow-up snapshots are scheduled, and the team gets the message.

import { refreshSoon } from './account.js';
import { track, withTimeout } from './background.js';
import { settings } from './config.js';
import {
  now,
  type DB,
  type EntryRow,
  type PublicationRow,
  type SnapshotKind,
  type SnapshotRow,
  type SubmissionRow,
  type TaskRow,
  type UserRow,
} from './db.js';
import { HubError } from './errors.js';
import { downloadMedia, saveMedia } from './media.js';
import { creatorLine, esc, notifyAdmins, notifyUser, reviewKeyboard } from './notify.js';
import { syncLevel } from './service.js';
import { getProvider } from './social/index.js';
import { parseLink, type LinkInfo } from './social/links.js';
import type { CheckResult, LinkChecks, PostResult } from './social/types.js';
import type { BlockedLink, PublicationView, SubmissionView } from './types.js';

export function publicationsOf(db: DB, entryId: number): PublicationRow[] {
  return db.prepare('SELECT * FROM publications WHERE entry_id = ? AND removed_at IS NULL ORDER BY id').all(entryId) as PublicationRow[];
}

export function publicationsOfTask(db: DB, taskId: string): PublicationRow[] {
  return db.prepare('SELECT * FROM publications WHERE task_id = ? AND removed_at IS NULL ORDER BY id').all(taskId) as PublicationRow[];
}

export function snapshotsOf(db: DB, publicationId: number): SnapshotRow[] {
  return db.prepare('SELECT * FROM snapshots WHERE publication_id = ? ORDER BY due_at').all(publicationId) as SnapshotRow[];
}

const HOUR = 60 * 60 * 1000;
/** How long one link may take to read before we treat it as unreadable. */
const PROVIDER_WAIT_MS = 200_000;
/** A send still 'checking' after this long was interrupted (a restart): it is picked up again. */
const SUBMISSION_STALE_MS = 10 * 60_000;
/** A measurement that fails is tried again an hour later, this many times in all. */
const SNAPSHOT_ATTEMPTS = 3;
/** Entry statuses from which a link may be sent, by review mode. */
const SEND_FROM = { post_first: ['joined', 'in_review', 'needs_changes'], draft_first: ['draft_approved', 'in_review', 'needs_changes'] };

const FOLLOW_UPS: SnapshotKind[] = ['h24', 'd7', 'd14'];

async function readPost(url: string): Promise<PostResult> {
  try {
    return await withTimeout(getProvider().fetchPost(url), PROVIDER_WAIT_MS, 'post lookup');
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

// --- Checks ------------------------------------------------------------------------

const lower = (value: string | null | undefined): string | null => value?.trim().replace(/^[@#]+/, '').toLowerCase() || null;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasTag(found: string[], caption: string | null, wanted: string, sign: '@' | '#'): CheckResult {
  if (found.includes(wanted)) return 'pass';
  if (caption && new RegExp(`${sign}${escapeRegExp(wanted)}(?![\\w.])`, 'i').test(caption)) return 'pass';
  // Nothing readable at all (a story without stickers we can see, a demo answer): we do not know.
  return caption === null && found.length === 0 ? 'unknown' : 'fail';
}

/** Runs the automatic checks for one link. Pure: the same answer for the same input. */
export function computeChecks(result: PostResult, info: LinkInfo, user: Pick<UserRow, 'instagram' | 'tiktok'>, task: TaskRow): LinkChecks {
  const post = result.status === 'ok' ? result.post : null;
  const platform = post?.platform ?? info.platform;
  const expected = lower(platform === 'instagram' ? user.instagram : platform === 'tiktok' ? user.tiktok : null);
  const author = lower(post?.authorHandle ?? info.author);

  const mention = lower(task.required_mention);
  const hashtag = lower(task.required_hashtag);
  const formats = JSON.parse(task.formats || '[]') as string[];
  const kind = post?.kind ?? info.kind;
  const published = post?.publishedAt ? new Date(post.publishedAt).getTime() : null;

  return {
    ownAccount: !author || !expected ? 'unknown' : author === expected ? 'pass' : 'fail',
    afterStart: !task.starts_at ? 'pass' : published === null ? 'unknown' : published >= new Date(task.starts_at).getTime() ? 'pass' : 'fail',
    mention: !mention ? 'pass' : !post ? 'unknown' : hasTag(post.mentions, post.caption, mention, '@'),
    hashtag: !hashtag ? 'pass' : !post ? 'unknown' : hasTag(post.hashtags, post.caption, hashtag, '#'),
    format: !formats.length ? 'pass' : kind === 'unknown' ? 'unknown' : formats.includes(kind) ? 'pass' : 'fail',
    reachable: result.status === 'ok' ? 'pass' : result.status === 'gone' ? 'fail' : 'unknown',
  };
}

const UNKNOWN_CHECKS: LinkChecks = {
  ownAccount: 'unknown',
  afterStart: 'unknown',
  mention: 'unknown',
  hashtag: 'unknown',
  format: 'unknown',
  reachable: 'unknown',
};

export function parseChecks(json: string): LinkChecks {
  try {
    return { ...UNKNOWN_CHECKS, ...(JSON.parse(json) as Partial<LinkChecks>) };
  } catch {
    return UNKNOWN_CHECKS;
  }
}

const KIND_NAME: Record<string, string> = { reel: 'reel', post: 'photo post', story: 'story', tiktok: 'TikTok video', unknown: 'unknown' };

/** The checks in plain words for the team. Passed checks are short, doubts say what to look at. */
export function checkLines(checks: LinkChecks, task: TaskRow, kind: string): string[] {
  const mark = (result: CheckResult): string => (result === 'pass' ? '✅' : result === 'fail' ? '⚠️' : '❔');
  const lines = [
    `${mark(checks.ownAccount)} ${checks.ownAccount === 'pass' ? 'Posted from their own account' : 'Could not see who posted it'}`,
    `${mark(checks.reachable)} ${
      checks.reachable === 'pass' ? 'The link opens' : checks.reachable === 'fail' ? 'The link does not open: deleted, expired or private' : 'Could not read the link, check it by hand'
    }`,
  ];
  if (task.starts_at) {
    lines.push(
      `${mark(checks.afterStart)} ${
        checks.afterStart === 'pass' ? 'Published after the task started' : checks.afterStart === 'fail' ? 'Published before the task started' : 'Could not read when it was published'
      }`,
    );
  }
  for (const [result, value, sign] of [
    [checks.mention, task.required_mention, '@'],
    [checks.hashtag, task.required_hashtag, '#'],
  ] as const) {
    if (!value) continue;
    const tag = `${sign}${esc(value.replace(/^[@#]+/, ''))}`;
    lines.push(`${mark(result)} ${result === 'pass' ? `Has ${tag}` : result === 'fail' ? `No ${tag} found` : `Could not check ${tag}`}`);
  }
  if ((JSON.parse(task.formats || '[]') as string[]).length) {
    lines.push(
      `${mark(checks.format)} ${
        checks.format === 'pass'
          ? `Format: ${KIND_NAME[kind] ?? kind}`
          : checks.format === 'fail'
            ? `Format ${KIND_NAME[kind] ?? kind} is not one the task asks for`
            : 'Could not tell the format'
      }`,
    );
  }
  return lines;
}

/** The team's message for a work in review: each link with its checks and its first numbers. */
export function submissionText(db: DB, entry: EntryRow, task: TaskRow, user: UserRow, heading: string): string {
  const lines = [`<b>${heading} #${entry.id}</b>`, `Task: ${esc(task.title)} (+${task.reward})`, `Creator: ${creatorLine(user)}`];
  if (user.account_status !== 'confirmed') {
    lines.push(`⏳ Their Instagram account is ${user.account_status === 'rejected' ? 'rejected' : 'not confirmed yet'}: confirm it before approving.`);
  }
  const publications = publicationsOf(db, entry.id);
  const links = publications.length ? publications.map((publication) => publication.url) : (JSON.parse(entry.links) as string[]);
  for (const url of links) {
    const publication = publications.find((candidate) => candidate.url === url);
    lines.push('', esc(url));
    if (!publication) continue;
    lines.push(...checkLines(parseChecks(publication.checks), task, publication.kind));
    const numbers = [
      publication.views !== null ? `${publication.views.toLocaleString('en-US')} views` : null,
      publication.likes !== null ? `${publication.likes.toLocaleString('en-US')} likes` : null,
      publication.comments !== null ? `${publication.comments.toLocaleString('en-US')} comments` : null,
    ].filter(Boolean);
    if (numbers.length) lines.push(`📊 Now: ${numbers.join(', ')}`);
    if (publication.kind === 'story') lines.push(`📸 Story ${publication.media_path ? 'copy saved' : 'copy could not be saved'}. The creator sends the views after 24 hours.`);
    if (publication.data_source === 'demo') lines.push('🧪 Sample data: no provider token is set.');
  }
  if (entry.note) lines.push('', `Note: ${esc(entry.note)}`);
  return lines.join('\n');
}

// --- Views for the app ---------------------------------------------------------------

export function publicationView(row: PublicationRow, entryApproved: boolean, at = Date.now()): PublicationView {
  const editable = !row.story_answered_at || !entryApproved;
  return {
    id: row.id,
    url: row.url,
    kind: row.kind,
    status: row.status,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    viewsSource: row.views_source,
    checks: parseChecks(row.checks),
    storyViewsOpen: row.kind === 'story' && editable && new Date(row.created_at).getTime() + 24 * HOUR <= at,
  };
}

export function latestSubmission(db: DB, entryId: number): SubmissionRow | undefined {
  return db.prepare('SELECT * FROM submissions WHERE entry_id = ? ORDER BY id DESC LIMIT 1').get(entryId) as SubmissionRow | undefined;
}

export function submissionView(row: SubmissionRow): SubmissionView {
  return {
    id: row.id,
    status: row.status,
    links: JSON.parse(row.links) as string[],
    blocked: row.status === 'blocked' ? (JSON.parse(row.result) as BlockedLink[]) : [],
    createdAt: row.created_at,
  };
}

// --- Sending links ---------------------------------------------------------------------

/** Stores the send and starts checking its links in the background. */
export function startSubmission(db: DB, entry: EntryRow, links: string[], note: string | null): SubmissionRow {
  const result = db
    .prepare(`INSERT INTO submissions (entry_id, user_id, task_id, links, note, status, created_at) VALUES (?, ?, ?, ?, ?, 'checking', ?)`)
    .run(entry.id, entry.user_id, entry.task_id, JSON.stringify(links), note, now());
  const id = Number(result.lastInsertRowid);
  track('submission check', processSubmission(db, id));
  return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow;
}

interface ReadLink {
  url: string;
  info: LinkInfo;
  result: PostResult;
  checks: LinkChecks;
  thumbPath: string | null;
  mediaPath: string | null;
}

/** Copies a picture or video we must keep. Never throws: a missing copy never blocks a send. */
async function keepCopy(url: string | null, zone: 'public' | 'private', folder: 'thumbs' | 'stories'): Promise<string | null> {
  if (!url) return null;
  const bytes = await downloadMedia(url);
  if (!bytes) return null;
  try {
    return (await saveMedia(zone, folder, bytes, { maxBytes: 30 * 1024 * 1024, allow: ['jpg', 'png', 'webp', 'mp4'] })).path;
  } catch {
    return null;
  }
}

/**
 * Checks the links of one send and, unless a link belongs to someone else, puts the work in
 * review. Safe to call twice: only one caller can claim a send. `offline` skips the provider
 * (used for a send that keeps failing): the links go in with unknown checks.
 */
export async function processSubmission(db: DB, submissionId: number, offline = false): Promise<void> {
  const staleBefore = new Date(Date.now() - SUBMISSION_STALE_MS).toISOString();
  const claimed = db
    .prepare(
      `UPDATE submissions SET claimed_at = ?, tries = tries + 1
       WHERE id = ? AND status = 'checking' AND (claimed_at IS NULL OR claimed_at < ?)`,
    )
    .run(now(), submissionId, staleBefore);
  if (!claimed.changes) return;

  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId) as SubmissionRow;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(submission.task_id) as TaskRow;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(submission.user_id) as UserRow;
  const links = JSON.parse(submission.links) as string[];
  const provider = getProvider();

  const read: ReadLink[] = await Promise.all(
    links.map(async (url) => {
      const info = parseLink(url);
      const result: PostResult = offline ? { status: 'error', message: 'not read' } : await readPost(url);
      return { url, info, result, checks: computeChecks(result, info, user, task), thumbPath: null, mediaPath: null };
    }),
  );

  const blocked: BlockedLink[] = read
    .filter((link) => link.checks.ownAccount === 'fail')
    .map((link) => ({
      url: link.url,
      author: lower((link.result.status === 'ok' ? link.result.post.authorHandle : null) ?? link.info.author),
      expected: link.info.platform === 'tiktok' ? user.tiktok : user.instagram,
    }));
  if (blocked.length) {
    db.prepare(`UPDATE submissions SET status = 'blocked', result = ?, finished_at = ? WHERE id = ?`).run(
      JSON.stringify(blocked),
      now(),
      submissionId,
    );
    return;
  }

  // Copies: a story disappears after 24 hours, so we keep it now (private to the team).
  for (const link of read) {
    if (link.result.status !== 'ok') continue;
    const post = link.result.post;
    if (post.kind === 'story') link.mediaPath = await keepCopy(post.mediaUrl ?? post.thumbUrl, 'private', 'stories');
    else link.thumbPath = await keepCopy(post.thumbUrl, 'public', 'thumbs');
  }

  const accepted = db.transaction((): { entry: EntryRow; resent: boolean } | null => {
    const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(submission.entry_id) as EntryRow;
    const latest = latestSubmission(db, entry.id);
    // A newer send replaced this one, or the work moved on (approved) while we were reading.
    if (latest?.id !== submissionId || !SEND_FROM[task.review_mode].includes(entry.status)) {
      db.prepare(`UPDATE submissions SET status = 'done', finished_at = ? WHERE id = ?`).run(now(), submissionId);
      return null;
    }
    const stamp = now();
    db.prepare(`UPDATE entries SET status = 'in_review', links = ?, note = ?, submitted_at = ? WHERE id = ?`).run(
      JSON.stringify(links),
      submission.note,
      stamp,
      entry.id,
    );
    storePublications(db, entry, read, provider.name, stamp);
    db.prepare(`UPDATE submissions SET status = 'done', finished_at = ? WHERE id = ?`).run(stamp, submissionId);
    syncEntryViews(db, entry.id);
    return { entry, resent: entry.status !== 'joined' && entry.status !== 'draft_approved' };
  })();
  if (!accepted) return;

  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(submission.entry_id) as EntryRow;
  void notifyAdmins(
    db,
    `${submissionText(db, entry, task, user, accepted.resent ? 'Resubmitted' : 'New submission')}\n\nApprove with a score for the work, or ask for changes.`,
    reviewKeyboard(entry.id),
  );
  // Fresh profile numbers for the reviewer, without spending a lookup on every resend.
  refreshSoon(db, user.id, HOUR);
}

function storePublications(db: DB, entry: EntryRow, read: ReadLink[], source: 'apify' | 'demo', stamp: string): void {
  const existing = publicationsOf(db, entry.id);
  const keep = new Set<number>();
  const insert = db.prepare(
    `INSERT INTO publications (entry_id, user_id, task_id, url, platform, kind, external_id, author_handle, published_at, caption,
       mentions, hashtags, thumb_path, media_path, checks, status, views, likes, comments, shares, views_source, created_at, data_source)
     VALUES (@entryId, @userId, @taskId, @url, @platform, @kind, @externalId, @author, @publishedAt, @caption,
       @mentions, @hashtags, @thumbPath, @mediaPath, @checks, @status, @views, @likes, @comments, @shares, @viewsSource, @now, @source)`,
  );
  const snapshot = db.prepare(
    `INSERT INTO snapshots (publication_id, kind, due_at, taken_at, status, views, likes, comments, shares, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const link of read) {
    const post = link.result.status === 'ok' ? link.result.post : null;
    const same = existing.find((publication) => publication.url === link.url);
    if (same) {
      // The same link sent again after "needs changes": keep its measurements, refresh its checks.
      keep.add(same.id);
      db.prepare('UPDATE publications SET checks = ? WHERE id = ?').run(JSON.stringify(link.checks), same.id);
      continue;
    }
    const row = insert.run({
      entryId: entry.id,
      userId: entry.user_id,
      taskId: entry.task_id,
      url: link.url,
      platform: post?.platform ?? link.info.platform,
      kind: post?.kind ?? link.info.kind,
      externalId: post?.externalId ?? link.info.id,
      author: post?.authorHandle ?? link.info.author,
      publishedAt: post?.publishedAt ?? null,
      caption: post?.caption?.slice(0, 2200) ?? null,
      mentions: JSON.stringify(post?.mentions ?? []),
      hashtags: JSON.stringify(post?.hashtags ?? []),
      thumbPath: link.thumbPath,
      mediaPath: link.mediaPath,
      checks: JSON.stringify(link.checks),
      // A link we cannot read at all (another site): the team counts it by hand.
      status: link.result.status === 'unsupported' ? 'unreachable' : 'tracking',
      views: post?.views ?? null,
      likes: post?.likes ?? null,
      comments: post?.comments ?? null,
      shares: post?.shares ?? null,
      viewsSource: post?.views !== null && post?.views !== undefined ? 'auto' : 'none',
      now: stamp,
      source,
    });
    const id = Number(row.lastInsertRowid);
    keep.add(id);
    if (post) snapshot.run(id, 'submit', stamp, stamp, 'done', post.views, post.likes, post.comments, post.shares, null);
    else snapshot.run(id, 'submit', stamp, stamp, 'failed', null, null, null, null, link.result.status);
    const start = new Date(stamp).getTime();
    FOLLOW_UPS.forEach((kind, index) => {
      const due = new Date(start + settings.metrics.scheduleHours[index]! * HOUR).toISOString();
      snapshot.run(id, kind, due, null, 'pending', null, null, null, null, null);
    });
  }

  // Links dropped from a resend: hidden from the entry, no more measurements.
  for (const publication of existing) {
    if (keep.has(publication.id)) continue;
    db.prepare('UPDATE publications SET removed_at = ? WHERE id = ?').run(stamp, publication.id);
    skipPending(db, publication.id, 'replaced by a resend');
  }
}

function skipPending(db: DB, publicationId: number, reason: string): void {
  db.prepare(`UPDATE snapshots SET status = 'skipped', error = ? WHERE publication_id = ? AND status = 'pending'`).run(reason, publicationId);
}

/**
 * entries.views = the sum of its publications' current views. Leaves an entry without any
 * measured publication alone (its views may have been set by hand with /views).
 */
export function syncEntryViews(db: DB, entryId: number): void {
  const row = db
    .prepare('SELECT COUNT(views) AS measured, COALESCE(SUM(views), 0) AS total FROM publications WHERE entry_id = ? AND removed_at IS NULL')
    .get(entryId) as { measured: number; total: number };
  if (!row.measured) return;
  const entry = db.prepare('SELECT user_id, views, status FROM entries WHERE id = ?').get(entryId) as Pick<EntryRow, 'user_id' | 'views' | 'status'>;
  if (entry.views === row.total) return;
  db.prepare('UPDATE entries SET views = ? WHERE id = ?').run(row.total, entryId);
  if (entry.status === 'approved') syncLevel(db, entry.user_id);
}

/** A publication that is no longer there before its final measurement. Tells the team once. */
function markRemoved(db: DB, publication: PublicationRow): void {
  const changed = db.prepare(`UPDATE publications SET status = 'removed' WHERE id = ? AND status = 'tracking'`).run(publication.id);
  skipPending(db, publication.id, 'publication removed');
  if (!changed.changes) return;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(publication.task_id) as TaskRow;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(publication.user_id) as UserRow;
  void notifyAdmins(
    db,
    [
      `<b>Publication removed</b> (submission #${publication.entry_id})`,
      `Task: ${esc(task.title)}`,
      `Creator: ${creatorLine(user)}`,
      esc(publication.url),
      'It was deleted or hidden before the final measurement. Coins are not taken back automatically.',
    ].join('\n'),
  );
}

function storeNumbers(db: DB, publicationId: number, post: { views: number | null; likes: number | null; comments: number | null; shares: number | null }): void {
  db.prepare(
    `UPDATE publications SET views = COALESCE(?, views), likes = COALESCE(?, likes), comments = COALESCE(?, comments),
       shares = COALESCE(?, shares), views_source = CASE WHEN ? IS NOT NULL THEN 'auto' ELSE views_source END
     WHERE id = ? AND views_source != 'creator'`,
  ).run(post.views, post.likes, post.comments, post.shares, post.views, publicationId);
}

// --- The admin's refresh button ---------------------------------------------------------

/**
 * Reads the publication again right now and stores what it finds: runs the checks again and
 * updates the current numbers. Does not add a snapshot. For the "refresh" button in the admin.
 */
export async function recheckPublication(db: DB, publicationId: number): Promise<PublicationRow> {
  const publication = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow | undefined;
  if (!publication) throw new HubError('publication_not_found', 'This publication does not exist.', 404);
  const result = await readPost(publication.url);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(publication.task_id) as TaskRow;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(publication.user_id) as UserRow;

  // A story is expected to vanish after 24 hours: that is not a removal, and the old checks stand.
  if (!(publication.kind === 'story' && result.status !== 'ok')) {
    db.prepare('UPDATE publications SET checks = ? WHERE id = ?').run(JSON.stringify(computeChecks(result, parseLink(publication.url), user, task)), publicationId);
  }
  if (result.status === 'ok') {
    const post = result.post;
    db.prepare(
      `UPDATE publications SET author_handle = COALESCE(?, author_handle), published_at = COALESCE(?, published_at),
         caption = COALESCE(?, caption), mentions = ?, hashtags = ? WHERE id = ?`,
    ).run(post.authorHandle, post.publishedAt, post.caption?.slice(0, 2200) ?? null, JSON.stringify(post.mentions), JSON.stringify(post.hashtags), publicationId);
    if (publication.kind !== 'story') storeNumbers(db, publicationId, post);
  } else if (result.status === 'gone' && publication.kind !== 'story') {
    markRemoved(db, publication);
  }
  syncEntryViews(db, publication.entry_id);
  return db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow;
}

// --- Follow-up measurements ----------------------------------------------------------------

let measuring = false;

/**
 * Takes every measurement that is due at `nowIso` (default: now). Safe to call twice.
 * Returns how many were taken. Called by the timer in jobs.ts, and by tests.
 */
export async function runDueSnapshots(db: DB, nowIso?: string): Promise<number> {
  if (measuring) return 0;
  measuring = true;
  try {
    const at = nowIso ?? now();
    const due = db
      .prepare(`SELECT * FROM snapshots WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, id LIMIT 200`)
      .all(at) as SnapshotRow[];
    let taken = 0;
    for (const snapshot of due) {
      if (await takeSnapshot(db, snapshot, at)) taken++;
    }
    return taken;
  } finally {
    measuring = false;
  }
}

async function takeSnapshot(db: DB, snapshot: SnapshotRow, at: string): Promise<boolean> {
  const publication = db.prepare('SELECT * FROM publications WHERE id = ?').get(snapshot.publication_id) as PublicationRow;
  const skip = (reason: string) => db.prepare(`UPDATE snapshots SET status = 'skipped', error = ? WHERE id = ? AND status = 'pending'`).run(reason, snapshot.id);
  if (publication.removed_at || publication.status !== 'tracking') {
    skip(`publication ${publication.removed_at ? 'replaced' : publication.status}`);
    return false;
  }
  // Nobody but the author sees a story's views: that number comes from the creator (setStoryViews).
  if (publication.kind === 'story') {
    skip('story views come from the creator');
    return false;
  }

  const result = await readPost(publication.url);
  const final = snapshot.kind === 'd14';
  const finish = () =>
    db.prepare(`UPDATE publications SET status = 'final', final_at = ? WHERE id = ? AND status = 'tracking'`).run(at, publication.id);

  if (result.status === 'ok') {
    const post = result.post;
    db.transaction(() => {
      db.prepare(
        `UPDATE snapshots SET status = 'done', taken_at = ?, views = ?, likes = ?, comments = ?, shares = ?, error = NULL
         WHERE id = ? AND status = 'pending'`,
      ).run(at, post.views, post.likes, post.comments, post.shares, snapshot.id);
      storeNumbers(db, publication.id, post);
      if (final) finish();
    })();
    syncEntryViews(db, publication.entry_id);
    return true;
  }

  if (result.status === 'gone') {
    db.prepare(`UPDATE snapshots SET status = 'failed', taken_at = ?, error = 'gone' WHERE id = ?`).run(at, snapshot.id);
    markRemoved(db, publication);
    return false;
  }

  // Provider trouble: try again in an hour, a few times. After that the last numbers stand.
  const attempts = snapshot.attempts + 1;
  if (result.status === 'error' && attempts < SNAPSHOT_ATTEMPTS) {
    const retry = new Date(new Date(at).getTime() + HOUR).toISOString();
    db.prepare('UPDATE snapshots SET attempts = ?, due_at = ?, error = ? WHERE id = ?').run(attempts, retry, result.message.slice(0, 200), snapshot.id);
    return false;
  }
  db.transaction(() => {
    db.prepare(`UPDATE snapshots SET status = 'failed', attempts = ?, taken_at = ?, error = ? WHERE id = ?`).run(
      attempts,
      at,
      result.status === 'error' ? result.message.slice(0, 200) : 'unsupported link',
      snapshot.id,
    );
    if (final) finish();
  })();
  return false;
}

// --- Stories ---------------------------------------------------------------------------------

/**
 * Stores the number of story views. `by` says who gave the number: the creator (with a
 * screenshot kept in the private media zone) or a team member correcting it in the admin.
 * Marks the publication's views_source as 'creator', makes the number final and updates
 * the entry's total views.
 */
export function setStoryViews(
  db: DB,
  publicationId: number,
  views: number,
  by: { kind: 'creator' } | { kind: 'team'; id: number },
  screenshotPath?: string | null,
): PublicationRow {
  const publication = db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow | undefined;
  if (!publication) throw new HubError('publication_not_found', 'This publication does not exist.', 404);
  if (publication.kind !== 'story') throw new HubError('not_a_story', 'Only stories take a number of views by hand.');
  if (!Number.isInteger(views) || views < 0 || views > 100_000_000) throw new HubError('bad_views', 'Enter the number of views as a whole number.');

  const stamp = now();
  db.transaction(() => {
    db.prepare(
      `UPDATE publications SET story_views = ?, views = ?, views_source = 'creator',
         story_screenshot_path = COALESCE(?, story_screenshot_path),
         story_answered_at = CASE WHEN ? THEN ? ELSE COALESCE(story_answered_at, ?) END,
         status = 'final', final_at = COALESCE(final_at, ?)
       WHERE id = ?`,
    ).run(views, views, screenshotPath ?? null, by.kind === 'creator' ? 1 : 0, stamp, stamp, stamp, publicationId);
    skipPending(db, publicationId, 'story views come from the creator');
  })();
  syncEntryViews(db, publication.entry_id);
  return db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId) as PublicationRow;
}

/**
 * 24 hours after a story was sent, asks the creator for its views, once. Reminds once more a day
 * later, then stops. Returns how many messages were sent.
 */
export function askForStoryViews(db: DB, nowIso = now()): number {
  const dayAgo = new Date(new Date(nowIso).getTime() - 24 * HOUR).toISOString();
  const stories = (where: string) =>
    db
      .prepare(
        `SELECT p.*, t.title AS task_title FROM publications p JOIN tasks t ON t.id = p.task_id
         WHERE p.kind = 'story' AND p.removed_at IS NULL AND p.story_answered_at IS NULL AND ${where}`,
      )
      .all(dayAgo) as Array<PublicationRow & { task_title: string }>;

  let sent = 0;
  for (const story of stories('p.story_asked_at IS NULL AND p.created_at <= ?')) {
    if (!db.prepare('UPDATE publications SET story_asked_at = ? WHERE id = ? AND story_asked_at IS NULL').run(nowIso, story.id).changes) continue;
    void notifyUser(
      story.user_id,
      `<b>How many people saw your story?</b> Your story for ${esc(story.task_title)} has been up for 24 hours. Send us the number of views, it takes a minute.`,
      { text: 'Send the number', path: `/stories/${story.id}` },
    );
    sent++;
  }
  for (const story of stories('p.story_reminded_at IS NULL AND p.story_asked_at <= ?')) {
    if (!db.prepare('UPDATE publications SET story_reminded_at = ? WHERE id = ? AND story_reminded_at IS NULL').run(nowIso, story.id).changes) continue;
    void notifyUser(
      story.user_id,
      `<b>A reminder:</b> we still need the number of views of your story for ${esc(story.task_title)}. You find it in your story archive.`,
      { text: 'Send the number', path: `/stories/${story.id}` },
    );
    sent++;
  }
  return sent;
}

/** Sends that were interrupted (a restart while reading links) are checked again. */
export async function resumeStaleSubmissions(db: DB, nowIso = now()): Promise<number> {
  const staleBefore = new Date(new Date(nowIso).getTime() - SUBMISSION_STALE_MS).toISOString();
  const rows = db
    .prepare(`SELECT id, tries FROM submissions WHERE status = 'checking' AND created_at <= ? AND (claimed_at IS NULL OR claimed_at < ?)`)
    .all(staleBefore, staleBefore) as Array<{ id: number; tries: number }>;
  for (const row of rows) await processSubmission(db, row.id, row.tries >= 3);
  return rows.length;
}
