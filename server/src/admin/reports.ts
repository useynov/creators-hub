// Task reports: totals and one row per publication with its four measurements, and the
// same table as an Excel file. Everyone on the team may read them, the Viewer included,
// so nothing here is personal beyond a creator's public name and Instagram handle.

import type { Hono } from 'hono';
import { settings } from '../config.js';
import type { DB, PublicationRow, SnapshotRow, TaskRow } from '../db.js';
import { allow, EVERYONE, type AdminEnv } from './auth.js';
import { KINDS } from './common.js';
import { reportWorkbook, xlsxResponse } from './excel.js';
import { bad, pageParams, queryOneOf, taskIdParam } from './input.js';
import type {
  PublicationStatus,
  Report,
  ReportCell,
  ReportRow,
  ReportSort,
  ReportTask,
  ReportTotals,
  SnapshotKind,
  TaskStatus,
  ViewsSourceLabel,
} from './types.js';

const STATUSES: readonly PublicationStatus[] = ['tracking', 'final', 'removed', 'unreachable'];
const SORTS: readonly ReportSort[] = ['final', 'date', 'creator', 'likes', 'comments'];
const SNAPS: readonly SnapshotKind[] = ['submit', 'h24', 'd7', 'd14'];

type PubRow = PublicationRow & { first_name: string; instagram: string | null };

export interface ReportQuery {
  kind: (typeof KINDS)[number] | 'all';
  status: PublicationStatus | 'all';
  sort: ReportSort;
  dir: 'asc' | 'desc';
}

export function reportTasks(db: DB): ReportTask[] {
  return db
    .prepare(
      `SELECT t.id, t.title, t.status, t.deadline, (SELECT COUNT(*) FROM publications p WHERE p.task_id = t.id) AS publications
       FROM tasks t WHERE t.status != 'draft' ORDER BY julianday(t.deadline) DESC`,
    )
    .all() as ReportTask[];
}

function sourceOf(pub: PubRow, checkedByTeam: boolean): ViewsSourceLabel {
  if (pub.views_source === 'creator') return checkedByTeam ? 'team' : pub.story_screenshot_path ? 'creator_screenshot' : 'creator';
  if (pub.views_source === 'auto') return pub.views === null ? 'auto_no_views' : 'auto';
  // A photo post has no public view count, but its likes and comments were measured.
  if (pub.kind === 'post' && (pub.likes !== null || pub.comments !== null)) return 'auto_no_views';
  return 'none';
}

function rowOf(pub: PubRow, snaps: SnapshotRow[], showCreator: boolean, checkedByTeam: boolean): ReportRow {
  const cells = Object.fromEntries(
    SNAPS.map((kind) => {
      const snap = snaps.find((s) => s.kind === kind);
      const cell: ReportCell = snap ? { status: snap.status, views: snap.views } : { status: 'none', views: null };
      return [kind, cell];
    }),
  ) as Record<SnapshotKind, ReportCell>;
  // A story's number comes from the creator (or the team), and counts as final.
  if (pub.views_source === 'creator' && pub.story_views !== null) cells.d14 = { status: 'done', views: pub.story_views };
  const taken = snaps.filter((s) => s.taken_at).map((s) => s.taken_at!).sort();
  return {
    publicationId: pub.id,
    creatorId: showCreator ? pub.user_id : null,
    name: pub.first_name,
    instagram: pub.instagram,
    url: pub.url,
    kind: pub.kind,
    publishedAt: pub.published_at ?? pub.created_at,
    cells,
    views: pub.views_source === 'creator' ? pub.story_views : pub.views,
    likes: pub.likes,
    comments: pub.comments,
    source: sourceOf(pub, checkedByTeam),
    lastMeasuredAt: taken.at(-1) ?? null,
    status: pub.status,
  };
}

function compare(sort: ReportSort): (a: ReportRow, b: ReportRow) => number {
  const nums = (pick: (row: ReportRow) => number | null) => (a: ReportRow, b: ReportRow) => (pick(a) ?? -1) - (pick(b) ?? -1);
  switch (sort) {
    case 'final':
      return nums((row) => row.views);
    case 'likes':
      return nums((row) => row.likes);
    case 'comments':
      return nums((row) => row.comments);
    case 'date':
      return (a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '');
    case 'creator':
      return (a, b) => a.name.localeCompare(b.name) || (a.instagram ?? '').localeCompare(b.instagram ?? '');
  }
}

/** Every row of the report, filtered and sorted: what the table pages through and what the Excel file holds. */
export function reportRows(db: DB, taskId: string, query: ReportQuery, showCreator: boolean): { rows: ReportRow[]; totals: ReportTotals; task: TaskRow } {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw bad('not_found', 'This task does not exist.', 404);
  const pubs = db
    .prepare(
      `SELECT p.*, u.first_name, u.instagram FROM publications p JOIN users u ON u.id = p.user_id WHERE p.task_id = ? ORDER BY p.id`,
    )
    .all(taskId) as Array<PubRow & { story_checked_by: number | null }>;
  const snapsOf = db.prepare('SELECT * FROM snapshots WHERE publication_id = ?');
  const all = pubs.map((pub) => rowOf(pub, snapsOf.all(pub.id) as SnapshotRow[], showCreator, pub.story_checked_by !== null));

  const counted = (row: ReportRow): number => row.views ?? 0;
  const entries = db
    .prepare(
      `SELECT COUNT(*) AS joined, COALESCE(SUM(status = 'approved'), 0) AS approved,
              COALESCE(SUM(CASE WHEN status = 'approved' THEN reward ELSE 0 END), 0) AS coins
       FROM entries WHERE task_id = ?`,
    )
    .get(taskId) as { joined: number; approved: number; coins: number };
  const views = all.reduce((sum, row) => sum + counted(row), 0);
  const rate = settings.cashout.rateKzt;
  const byKind: ReportTotals['byKind'] = {};
  for (const row of all) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  const totals: ReportTotals = {
    publications: all.length,
    byKind,
    creators: new Set(pubs.map((pub) => pub.user_id)).size,
    joined: entries.joined,
    views,
    statedViews: all.filter((row) => ['creator', 'creator_screenshot', 'team'].includes(row.source)).reduce((sum, row) => sum + counted(row), 0),
    likesComments: all.filter((row) => row.kind !== 'story').reduce((sum, row) => sum + (row.likes ?? 0) + (row.comments ?? 0), 0),
    coinsPaid: entries.coins,
    approved: entries.approved,
    costPer1000: rate && views > 0 ? Math.round(((entries.coins * rate) / views) * 1000) : null,
    removed: all.filter((row) => row.status === 'removed').length,
  };

  const filtered = all.filter((row) => (query.kind === 'all' || row.kind === query.kind) && (query.status === 'all' || row.status === query.status));
  const order = compare(query.sort);
  filtered.sort((a, b) => (query.dir === 'desc' ? order(b, a) : order(a, b)) || a.publicationId - b.publicationId);
  return { rows: filtered, totals, task };
}

function finalAt(db: DB, taskId: string): string | null {
  const row = db
    .prepare(`SELECT MAX(s.due_at) AS at FROM snapshots s JOIN publications p ON p.id = s.publication_id WHERE p.task_id = ? AND s.kind = 'd14'`)
    .get(taskId) as { at: string | null };
  return row.at;
}

function readQuery(c: { req: { query: (key: string) => string | undefined } }): ReportQuery {
  return {
    kind: queryOneOf(c.req.query('kind'), ['all', ...KINDS] as const, 'all'),
    status: queryOneOf(c.req.query('status'), ['all', ...STATUSES] as const, 'all'),
    sort: queryOneOf(c.req.query('sort'), SORTS, 'final'),
    dir: queryOneOf(c.req.query('dir'), ['asc', 'desc'] as const, 'desc'),
  };
}

export function reportRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/reports', allow(...EVERYONE), (c) => c.json(reportTasks(db)));

  api.get('/reports/:id', allow(...EVERYONE), (c) => {
    const taskId = taskIdParam(c.req.param('id'));
    const page = pageParams(c, 50);
    const { rows, totals, task } = reportRows(db, taskId, readQuery(c), c.get('actor').role !== 'viewer');
    const report: Report = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status as TaskStatus,
        startsAt: task.starts_at,
        deadline: task.deadline,
        place: task.place,
        finalAt: finalAt(db, taskId),
      },
      totals,
      rows: rows.slice(page.offset, page.offset + page.pageSize),
      total: rows.length,
      page: page.page,
      pageSize: page.pageSize,
    };
    return c.json(report);
  });

  api.get('/reports/:id/export', allow(...EVERYONE), async (c) => {
    const taskId = taskIdParam(c.req.param('id'));
    const lang = queryOneOf(c.req.query('lang'), ['ru', 'en'] as const, 'ru');
    const { rows, totals, task } = reportRows(db, taskId, readQuery(c), false);
    const file = await reportWorkbook(task.title, rows, totals, lang);
    return xlsxResponse(c, file, `report-${task.id}.xlsx`);
  });
}
