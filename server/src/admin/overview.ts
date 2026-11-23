// The first screen: what waits for the team, the month in numbers, active tasks, alerts.

import type { Hono } from 'hono';
import { settings } from '../config.js';
import type { DB } from '../db.js';
import { localDate, monthStart } from '../service.js';
import { allow, STAFF, type AdminEnv } from './auth.js';
import { audienceOf, formatsOf } from './common.js';
import { parseJson } from './input.js';
import { counters, STORIES_TO_CHECK_SQL } from './session.js';
import type { AudienceInput, Overview, OverviewAlert, PublicationKind, TaskFunnel } from './types.js';

/** The funnel columns of a task: joined, sent a link, approved, views. Use with `FROM tasks t`. */
export const FUNNEL_SQL = `
  (SELECT COUNT(*) FROM entries e WHERE e.task_id = t.id) AS joined,
  (SELECT COUNT(*) FROM entries e WHERE e.task_id = t.id
     AND (e.submitted_at IS NOT NULL OR e.status IN ('in_review', 'needs_changes', 'approved'))) AS submitted,
  (SELECT COUNT(*) FROM entries e WHERE e.task_id = t.id AND e.status = 'approved') AS approved,
  (SELECT COALESCE(SUM(e.views), 0) FROM entries e WHERE e.task_id = t.id) AS views`;

/** A task the creators can see right now. Deadlines carry an offset, so compare instants, not strings. */
export const LIVE_TASK_SQL = `t.status = 'active' AND t.active = 1 AND julianday(t.deadline) >= julianday('now')`;

export interface FunnelRow {
  id: string;
  title: string;
  formats: string;
  place: string | null;
  audience: string;
  deadline: string;
  joined: number;
  submitted: number;
  approved: number;
  views: number;
}

export const funnelView = (row: FunnelRow): TaskFunnel => ({
  id: row.id,
  title: row.title,
  formats: formatsOf(row.formats),
  place: row.place,
  audience: audienceOf(row.audience) as AudienceInput,
  deadline: row.deadline,
  joined: row.joined,
  submitted: row.submitted,
  approved: row.approved,
  views: row.views,
});

/** Views that count for a publication: the creator's stated number for a story, otherwise the measured one. */
export const COUNTED_VIEWS_SQL = `CASE WHEN p.views_source = 'creator' THEN COALESCE(p.story_views, 0) ELSE COALESCE(p.views, 0) END`;

const handleOf = (row: { instagram: string | null; first_name: string }): string => (row.instagram ? `@${row.instagram}` : row.first_name);

function alerts(db: DB): OverviewAlert[] {
  const list: OverviewAlert[] = [];

  const removed = db
    .prepare(
      `SELECT u.instagram, u.first_name, t.title FROM publications p JOIN users u ON u.id = p.user_id JOIN tasks t ON t.id = p.task_id
       WHERE p.status = 'removed' AND julianday(p.created_at) >= julianday('now', '-30 days') ORDER BY p.id DESC`,
    )
    .all() as Array<{ instagram: string | null; first_name: string; title: string }>;
  if (removed.length) list.push({ kind: 'removed', count: removed.length, who: removed.slice(0, 3).map(handleOf), task: removed[0]!.title });

  const stories = db
    .prepare(
      `SELECT u.instagram, u.first_name FROM publications p JOIN users u ON u.id = p.user_id
       WHERE p.kind = 'story' AND p.status != 'removed' AND p.story_views IS NULL AND julianday(p.created_at) <= julianday('now', '-2 days')
       ORDER BY p.id`,
    )
    .all() as Array<{ instagram: string | null; first_name: string }>;
  if (stories.length) list.push({ kind: 'story_numbers', count: stories.length, who: stories.slice(0, 3).map(handleOf), task: null });

  const closed = db
    .prepare(
      `SELECT u.instagram, u.first_name FROM social_profiles sp JOIN users u ON u.id = sp.user_id
       WHERE sp.platform = 'instagram' AND sp.status = 'private' AND u.onboarded_at IS NOT NULL AND u.account_status != 'rejected'
       ORDER BY sp.fetched_at DESC`,
    )
    .all() as Array<{ instagram: string | null; first_name: string }>;
  if (closed.length) list.push({ kind: 'went_private', count: closed.length, who: closed.slice(0, 3).map(handleOf), task: null });

  // Works waiting for review that came with a flag from the automatic checks (other than the account).
  const waiting = db
    .prepare(
      `SELECT e.id, p.checks, u.instagram, u.first_name FROM entries e JOIN publications p ON p.entry_id = e.id JOIN users u ON u.id = e.user_id
       WHERE e.status = 'in_review'`,
    )
    .all() as Array<{ id: number; checks: string; instagram: string | null; first_name: string }>;
  const flagged = new Map<number, string>();
  for (const row of waiting) {
    const checks = parseJson<Record<string, unknown>>(row.checks, {});
    const keys = ['afterStart', 'mention', 'hashtag', 'format', 'reachable'];
    if (keys.some((key) => checks[key] === 'fail' || checks[key] === 'unknown')) flagged.set(row.id, handleOf(row));
  }
  if (flagged.size) list.push({ kind: 'flagged', count: flagged.size, who: [...flagged.values()].slice(0, 3), task: null });

  return list;
}

export function overview(db: DB): Overview {
  const since = monthStart();
  const one = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...params) as T;

  const creators = one<{ total: number; confirmed: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(account_status = 'confirmed'), 0) AS confirmed FROM users WHERE onboarded_at IS NOT NULL`,
  );
  const active = one<{ n: number }>(
    `SELECT COUNT(DISTINCT user_id) AS n FROM entries WHERE submitted_at IS NOT NULL AND julianday(submitted_at) >= julianday(?)`,
    since,
  ).n;
  const kinds = db
    .prepare(
      `SELECT p.kind, COUNT(*) AS n, COALESCE(SUM(${COUNTED_VIEWS_SQL}), 0) AS views FROM publications p
       WHERE julianday(p.created_at) >= julianday(?) GROUP BY p.kind`,
    )
    .all(since) as Array<{ kind: PublicationKind; n: number; views: number }>;
  const coins = one<{ n: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE amount > 0 AND kind IN ('task', 'bonus', 'event')
     AND julianday(created_at) >= julianday(?)`,
    since,
  ).n;
  const views = kinds.reduce((sum, row) => sum + row.views, 0);
  const rate = settings.cashout.rateKzt;

  const tasks = db
    .prepare(`SELECT t.id, t.title, t.formats, t.place, t.audience, t.deadline, ${FUNNEL_SQL} FROM tasks t WHERE ${LIVE_TASK_SQL} ORDER BY julianday(t.deadline)`)
    .all() as FunnelRow[];

  const oldest = one<{ at: string | null }>(`SELECT MIN(submitted_at) AS at FROM entries WHERE status = 'in_review'`).at;

  return {
    month: localDate().slice(0, 7),
    todo: { ...counters(db), oldestReviewAt: oldest },
    kpi: {
      creators: creators.total,
      confirmed: creators.confirmed,
      activeThisMonth: active,
      publications: kinds.reduce((sum, row) => sum + row.n, 0),
      byKind: Object.fromEntries(kinds.map((row) => [row.kind, row.n])),
      views,
      coinsIssued: coins,
      costPer1000: rate && views > 0 ? Math.round(((coins * rate) / views) * 1000) : null,
    },
    tasks: tasks.map(funnelView),
    alerts: alerts(db),
  };
}

export function overviewRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/overview', allow(...STAFF), (c) => c.json(overview(db)));
}
