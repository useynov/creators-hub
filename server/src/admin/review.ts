// Review: works and drafts waiting for the team, story numbers to check, and the private
// media behind them (story copies, statistics screenshots). Owner and Manager only.

import type { Hono } from 'hono';
import { recheckPublication, setStoryViews, snapshotsOf } from '../pipeline.js';
import { now, type DB, type EntryRow, type PublicationRow, type TaskRow, type UserRow } from '../db.js';
import { readMedia } from '../media.js';
import { approveDraft, approveEntry, getUser, requestChanges } from '../service.js';
import { audit, creatorCall, creatorCallAsync } from './audit.js';
import { allow, STAFF, type AdminEnv } from './auth.js';
import { formatsOf, localMedia } from './common.js';
import { bad, idParam, parseJson, readJson, requiredInt, requiredText } from './input.js';
import { STORIES_TO_CHECK_SQL } from './session.js';
import type {
  CheckResult,
  EntryDetail,
  LinkChecksView,
  PublicationKind,
  PublicationView,
  QueueItem,
  ReviewFlag,
  ReviewQueues,
  StoryItem,
} from './types.js';

type PubRow = PublicationRow & { story_checked_at: string | null; story_checked_by: number | null };

const CHECK_KEYS = ['ownAccount', 'afterStart', 'mention', 'hashtag', 'format', 'reachable'] as const;
const RESULTS: readonly CheckResult[] = ['pass', 'fail', 'unknown'];

/** The stored checks, or null while the automatic check has not run. Anything odd reads as "unknown". */
export function checksOf(json: string): LinkChecksView | null {
  const raw = parseJson<Record<string, unknown>>(json, {});
  if (!raw || typeof raw !== 'object' || !CHECK_KEYS.some((key) => key in raw)) return null;
  const read = (key: (typeof CHECK_KEYS)[number]): CheckResult =>
    (RESULTS as readonly unknown[]).includes(raw[key]) ? (raw[key] as CheckResult) : 'unknown';
  return {
    ownAccount: read('ownAccount'),
    afterStart: read('afterStart'),
    mention: read('mention'),
    hashtag: read('hashtag'),
    format: read('format'),
    reachable: read('reachable'),
  };
}

const FLAG_ORDER: Array<[keyof LinkChecksView, ReviewFlag]> = [
  ['ownAccount', 'own_account'],
  ['afterStart', 'after_start'],
  ['mention', 'mention'],
  ['hashtag', 'hashtag'],
  ['format', 'format'],
  ['reachable', 'reachable'],
];

/** The one thing a reviewer should know first about a work in the queue. */
function flagOf(user: Pick<UserRow, 'account_status'>, pubs: PubRow[]): ReviewFlag {
  if (user.account_status !== 'confirmed') return 'account_unconfirmed';
  const checks = pubs.map((pub) => checksOf(pub.checks));
  for (const [key, flag] of FLAG_ORDER) if (checks.some((c) => c && c[key] !== 'pass')) return flag;
  if (!pubs.length || checks.some((c) => !c)) return 'unchecked';
  if (pubs.some((pub) => pub.kind === 'story' && pub.media_path)) return 'story_saved';
  return 'ok';
}

type QueueRow = EntryRow & { first_name: string; instagram: string | null; account_status: UserRow['account_status']; title: string };

function queue(db: DB, status: 'in_review' | 'draft_review'): QueueItem[] {
  const since = status === 'in_review' ? 'e.submitted_at' : 'e.draft_sent_at';
  const rows = db
    .prepare(
      `SELECT e.*, u.first_name, u.instagram, u.account_status, t.title FROM entries e
       JOIN users u ON u.id = e.user_id JOIN tasks t ON t.id = e.task_id
       WHERE e.status = ? ORDER BY ${since} IS NULL, ${since} ASC LIMIT 200`,
    )
    .all(status) as QueueRow[];
  const pubsOf = db.prepare('SELECT * FROM publications WHERE entry_id = ? ORDER BY id');
  return rows.map((row) => {
    const pubs = status === 'in_review' ? (pubsOf.all(row.id) as PubRow[]) : [];
    return {
      entryId: row.id,
      creator: { id: row.user_id, name: row.first_name, instagram: row.instagram },
      task: { id: row.task_id, title: row.title },
      kinds: [...new Set(pubs.map((pub) => pub.kind))],
      waitingSince: (status === 'in_review' ? row.submitted_at : row.draft_sent_at) ?? row.joined_at,
      flag: status === 'in_review' ? flagOf(row, pubs) : row.account_status !== 'confirmed' ? 'account_unconfirmed' : 'ok',
    };
  });
}

function stories(db: DB): StoryItem[] {
  const rows = db
    .prepare(
      `SELECT p.*, u.first_name, u.instagram, t.title FROM publications p JOIN users u ON u.id = p.user_id JOIN tasks t ON t.id = p.task_id
       WHERE ${STORIES_TO_CHECK_SQL} ORDER BY p.story_answered_at IS NULL, p.created_at ASC LIMIT 200`,
    )
    .all() as Array<PubRow & { first_name: string; instagram: string | null; title: string }>;
  return rows.map((row) => ({
    publicationId: row.id,
    entryId: row.entry_id,
    creator: { id: row.user_id, name: row.first_name, instagram: row.instagram },
    task: { id: row.task_id, title: row.title },
    url: row.url,
    createdAt: row.created_at,
    askedAt: row.story_asked_at,
    answeredAt: row.story_answered_at,
    views: row.story_views,
    checked: Boolean(row.story_checked_at),
    hasScreenshot: Boolean(row.story_screenshot_path),
    hasCopy: Boolean(row.media_path),
  }));
}

export function reviewQueues(db: DB): ReviewQueues {
  const works = queue(db, 'in_review');
  const drafts = queue(db, 'draft_review');
  const storyList = stories(db);
  return { counts: { works: works.length, drafts: drafts.length, stories: storyList.length }, works, drafts, stories: storyList };
}

function publicationView(db: DB, pub: PubRow): PublicationView {
  return {
    id: pub.id,
    url: pub.url,
    kind: pub.kind,
    status: pub.status,
    authorHandle: pub.author_handle,
    publishedAt: pub.published_at,
    checks: checksOf(pub.checks),
    views: pub.views,
    likes: pub.likes,
    comments: pub.comments,
    viewsSource: pub.views_source,
    storyViews: pub.story_views,
    thumbUrl: localMedia(pub.thumb_path),
    storyCopyUrl: pub.media_path ? `/api/admin/media/publications/${pub.id}/story` : null,
    screenshotUrl: pub.story_screenshot_path ? `/api/admin/media/publications/${pub.id}/screenshot` : null,
    snapshots: snapshotsOf(db, pub.id).map((snap) => ({
      kind: snap.kind,
      dueAt: snap.due_at,
      takenAt: snap.taken_at,
      status: snap.status,
      views: snap.views,
      likes: snap.likes,
      comments: snap.comments,
    })),
  };
}

function getEntry(db: DB, id: number): EntryRow {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined;
  if (!entry) throw bad('not_found', 'This submission does not exist.', 404);
  return entry;
}

export function entryDetail(db: DB, id: number): EntryDetail {
  const entry = getEntry(db, id);
  const user = getUser(db, entry.user_id)!;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(entry.task_id) as TaskRow;
  const profile = db.prepare(`SELECT avg_reel_views, avatar_url FROM social_profiles WHERE user_id = ? AND platform = 'instagram'`).get(user.id) as
    | { avg_reel_views: number | null; avatar_url: string | null }
    | undefined;
  // Removed publications stay visible to the reviewer: that is exactly what they need to know.
  const pubs = db.prepare('SELECT * FROM publications WHERE entry_id = ? ORDER BY id').all(id) as PubRow[];
  const links = parseJson<unknown>(entry.links, []);
  return {
    id: entry.id,
    status: entry.status,
    creator: {
      id: user.id,
      name: user.first_name,
      instagram: user.instagram,
      avatarUrl: localMedia(user.avatar_url) ?? localMedia(profile?.avatar_url),
      accountStatus: user.account_status,
      avgReelViews: profile?.avg_reel_views ?? null,
    },
    task: {
      id: task.id,
      title: task.title,
      reward: task.reward,
      reviewMode: task.review_mode,
      startsAt: task.starts_at,
      requiredMention: task.required_mention,
      requiredHashtag: task.required_hashtag,
      formats: formatsOf(task.formats) as PublicationKind[],
    },
    submittedAt: entry.submitted_at,
    resent: entry.status === 'in_review' && Boolean(entry.comment_at),
    links: Array.isArray(links) ? links.filter((link): link is string => typeof link === 'string') : [],
    note: entry.note,
    lastComment: entry.comment,
    draftLink: entry.draft_link,
    draftInBot: Boolean(entry.draft_file_id),
    draftSentAt: entry.draft_sent_at,
    publications: pubs.map((pub) => publicationView(db, pub)),
  };
}

function getPublication(db: DB, id: number): PubRow {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(id) as PubRow | undefined;
  if (!pub) throw bad('not_found', 'This publication does not exist.', 404);
  return pub;
}

function getStory(db: DB, id: number): PubRow {
  const pub = getPublication(db, id);
  if (pub.kind !== 'story') throw bad('not_a_story', 'This publication is not a story.', 400);
  return pub;
}

export function reviewRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/review', allow(...STAFF), (c) => c.json(reviewQueues(db)));
  api.get('/review/entries/:id', allow(...STAFF), (c) => c.json(entryDetail(db, idParam(c.req.param('id')))));

  api.post('/review/entries/:id/approve', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const score = requiredInt(body.score, 'score', { min: 1, max: 5 });
    const entry = getEntry(db, id);
    if (getUser(db, entry.user_id)?.account_status !== 'confirmed') {
      throw bad('account_not_confirmed', 'The creator’s Instagram account is not confirmed yet. Confirm it on their card first.', 409);
    }
    // approveEntry pays inside one transaction and only from "in review": a second press is refused.
    const result = approveEntry(db, id, score);
    audit(db, c.get('actor').id, 'review.approve', id, `score ${score}, ${result.reward} coins`);
    return c.json(entryDetail(db, id));
  });

  api.post('/review/entries/:id/changes', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const comment = requiredText(body.comment, 'comment', { max: 2000, multiline: true });
    getEntry(db, id);
    requestChanges(db, id, comment);
    audit(db, c.get('actor').id, 'review.changes', id);
    return c.json(entryDetail(db, id));
  });

  api.post('/review/entries/:id/approve-draft', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    await readJson(c);
    getEntry(db, id);
    approveDraft(db, id);
    audit(db, c.get('actor').id, 'review.approve_draft', id);
    return c.json(entryDetail(db, id));
  });

  api.post('/review/publications/:id/recheck', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    await readJson(c);
    getPublication(db, id);
    await creatorCallAsync('recheckPublication', () => recheckPublication(db, id));
    audit(db, c.get('actor').id, 'review.recheck', id);
    return c.json(publicationView(db, getPublication(db, id)));
  });

  // The team corrects a stated number: it becomes the publication's number, checked, by this person.
  api.post('/review/stories/:id/views', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const views = requiredInt(body.views, 'views', { min: 0, max: 100_000_000 });
    getStory(db, id);
    const actor = c.get('actor');
    creatorCall('setStoryViews', () => setStoryViews(db, id, views, { kind: 'team', id: actor.id }));
    db.prepare('UPDATE publications SET story_checked_at = ?, story_checked_by = ? WHERE id = ?').run(now(), actor.id, id);
    audit(db, actor.id, 'review.story_views', id, `views ${views}`);
    return c.json(reviewQueues(db));
  });

  // The team accepts the stated number as it is.
  api.post('/review/stories/:id/confirm', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    await readJson(c);
    const pub = getStory(db, id);
    if (pub.story_views === null) throw bad('no_number', 'The creator has not stated a number yet. Enter it yourself.', 409);
    // story_checked_by stays empty: it names a team member who corrected the number, and this one was kept.
    const changed = db.prepare('UPDATE publications SET story_checked_at = ? WHERE id = ? AND story_checked_at IS NULL').run(now(), id).changes;
    if (changed) audit(db, c.get('actor').id, 'review.story_confirm', id);
    return c.json(reviewQueues(db));
  });

  // Private media: chosen by publication id, never by a path from the request.
  api.get('/media/publications/:id/:which{story|screenshot}', allow(...STAFF), async (c) => {
    const pub = getPublication(db, idParam(c.req.param('id')));
    const path = c.req.param('which') === 'story' ? pub.media_path : pub.story_screenshot_path;
    const file = path ? await readMedia('private', path) : null;
    if (!file) throw bad('not_found', 'This file is not available.', 404);
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    });
  });
}
