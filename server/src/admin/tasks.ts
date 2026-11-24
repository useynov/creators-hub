// Tasks: the list by tab, the editor, publishing and announcing, and "N creators will see this".
// Owner and Manager only.

import type { Hono } from 'hono';
import type { Audience } from '../audience.js';
import { settings } from '../config.js';
import { now, type DB, type TaskRow } from '../db.js';
import { announceTask } from '../service.js';
import type { ReviewMode } from '../types.js';
import { audit } from './audit.js';
import { allow, STAFF, type AdminEnv } from './auth.js';
import { applyInviteTags, audienceOf, formatsOf, fromLocalInput, LEVELS, loadSubjects, localMedia, reachOf, TASK_FORMATS, toLocalInput } from './common.js';
import {
  bad,
  int,
  oneOf,
  pageParams,
  parseJson,
  queryOneOf,
  readJson,
  requiredInt,
  requiredText,
  stringList,
  taskIdParam,
  text,
} from './input.js';
import { FUNNEL_SQL, funnelView, type FunnelRow } from './overview.js';
import type {
  AudienceCount,
  AudienceInput,
  CreatorPick,
  PublicationKind,
  TaskAction,
  TaskDetail,
  TaskList,
  TaskSaved,
  TaskTab,
} from './types.js';

type AdminTaskRow = TaskRow & { announced_at: string | null };

/** Where each tab's tasks come from. A seed task removed from the content file (active = 0) is closed. */
const TAB_SQL: Record<TaskTab, string> = {
  active: `t.status = 'active' AND t.active = 1 AND julianday(t.deadline) >= julianday('now')`,
  draft: `t.status = 'draft'`,
  closed: `t.status = 'closed' OR (t.status = 'active' AND (t.active = 0 OR julianday(t.deadline) < julianday('now')))`,
};

/** Only covers we stored ourselves can be set from the editor. */
const OUR_COVER = /^\/media\/covers\/[0-9a-f]{24}\.(jpg|png|webp)$/;
const MENTION = /^[A-Za-z0-9._]{1,30}$/;
const HASHTAG = /^[\p{L}\p{N}_]{1,60}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// --- Reading ---------------------------------------------------------------

function getTask(db: DB, id: string): AdminTaskRow {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as AdminTaskRow | undefined;
  if (!task) throw bad('not_found', 'This task does not exist.', 404);
  return task;
}

function picked(db: DB, audience: Audience): CreatorPick[] {
  if (audience.mode !== 'list' || !audience.userIds?.length) return [];
  const ids = audience.userIds.slice(0, 2000);
  const rows = db
    .prepare(`SELECT id, first_name, instagram FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY first_name COLLATE NOCASE`)
    .all(...ids) as Array<{ id: number; first_name: string; instagram: string | null }>;
  return rows.map((row) => ({ id: row.id, name: row.first_name, instagram: row.instagram }));
}

function stepsOf(json: string): string[] {
  const steps = parseJson<unknown>(json, []);
  return Array.isArray(steps) ? steps.filter((step): step is string => typeof step === 'string') : [];
}

export function taskDetail(db: DB, id: string): TaskDetail {
  const task = getTask(db, id);
  const audience = audienceOf(task.audience);
  const joined = (db.prepare('SELECT COUNT(*) AS n FROM entries WHERE task_id = ?').get(id) as { n: number }).n;
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    brief: task.brief,
    steps: stepsOf(task.steps),
    place: task.place,
    date: task.date,
    coverUrl: localMedia(task.cover_url),
    remoteCover: Boolean(task.cover_url) && !localMedia(task.cover_url),
    formats: formatsOf(task.formats),
    requiredMention: task.required_mention,
    requiredHashtag: task.required_hashtag,
    reviewMode: task.review_mode,
    reward: task.reward,
    maxPublications: task.max_publications,
    bonusCoins: task.bonus_coins,
    maxParticipants: task.max_participants,
    startsAt: toLocalInput(task.starts_at),
    deadline: toLocalInput(task.deadline) ?? '',
    audience: audience as AudienceInput,
    status: task.status,
    source: task.source,
    announcedAt: task.announced_at,
    picked: picked(db, audience),
    joined,
  };
}

export function listTaskTab(db: DB, tab: TaskTab, page: { page: number; pageSize: number; offset: number }): TaskList {
  const count = (where: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${where}`).get() as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.formats, t.place, t.audience, t.deadline, t.status, t.reward, t.review_mode, ${FUNNEL_SQL}
       FROM tasks t WHERE ${TAB_SQL[tab]} ORDER BY julianday(t.deadline) ${tab === 'closed' ? 'DESC' : 'ASC'}, t.sort LIMIT ? OFFSET ?`,
    )
    .all(page.pageSize, page.offset) as Array<FunnelRow & { status: TaskRow['status']; reward: number; review_mode: ReviewMode }>;
  const subjects = rows.length ? loadSubjects(db) : [];
  return {
    rows: rows.map((row) => ({
      ...funnelView(row),
      status: row.status,
      reward: row.reward,
      reviewMode: row.review_mode,
      reach: reachOf(subjects, audienceOf(row.audience)),
    })),
    total: count(TAB_SQL[tab]),
    page: page.page,
    pageSize: page.pageSize,
    counts: { active: count(TAB_SQL.active), draft: count(TAB_SQL.draft), closed: count(TAB_SQL.closed) },
  };
}

// --- Checking what the editor sends --------------------------------------------

/** The audience as stored: only known fields, checked, list ids limited to people who exist. */
export function cleanAudience(db: DB, value: unknown): Audience {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('bad_field', 'audience must be an object.');
  const raw = value as Record<string, unknown>;
  const mode = oneOf(raw.mode, 'audience.mode', ['all', 'segment', 'list'] as const);
  if (mode === 'all') return { mode };
  if (mode === 'list') {
    if (!Array.isArray(raw.userIds)) throw bad('bad_field', 'audience.userIds must be a list.');
    if (raw.userIds.length > 2000) throw bad('too_many', 'At most 2000 creators in a list.');
    const exists = db.prepare('SELECT 1 FROM users WHERE id = ?');
    const ids = [
      ...new Set(raw.userIds.map((id) => {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw bad('bad_field', 'audience.userIds must be Telegram ids.');
        return id;
      })),
    ].filter((id) => exists.get(id));
    return { mode, userIds: ids };
  }
  const followersMin = int(raw.followersMin, 'audience.followersMin', { min: 0, max: 1_000_000_000 });
  const followersMax = int(raw.followersMax, 'audience.followersMax', { min: 0, max: 1_000_000_000 });
  if (followersMin !== null && followersMax !== null && followersMin > followersMax) {
    throw bad('bad_range', 'The lower follower bound is above the upper one.');
  }
  const levels = stringList(raw.levels, 'audience.levels', { maxItems: 3, maxLength: 10 });
  if (levels.some((level) => !(LEVELS as readonly string[]).includes(level))) throw bad('bad_field', 'audience.levels: member, pro or partner.');
  return {
    mode,
    cities: stringList(raw.cities, 'audience.cities', { maxItems: 20, maxLength: 80 }),
    followersMin,
    followersMax,
    levels: levels as Audience['levels'],
    tags: stringList(raw.tags, 'audience.tags', { maxItems: 20, maxLength: 30 }).map((tag) => tag.toLowerCase()),
  };
}

interface CleanTask {
  title: string;
  summary: string | null;
  brief: string | null;
  steps: string[];
  place: string | null;
  date: string | null;
  coverUrl: string | null;
  formats: PublicationKind[];
  requiredMention: string | null;
  requiredHashtag: string | null;
  reviewMode: ReviewMode;
  reward: number;
  maxPublications: number;
  bonusCoins: number | null;
  maxParticipants: number | null;
  startsAt: string | null;
  deadline: string;
  audience: Audience;
}

function localTime(value: unknown, field: string, required: boolean): string | null {
  const raw = text(value, field, { max: 16, required });
  if (raw === null) return null;
  const iso = fromLocalInput(raw);
  if (!iso) throw bad('bad_date', `${field} is not a valid date and time.`);
  return iso;
}

export function cleanTask(db: DB, value: unknown, existing: AdminTaskRow | null): CleanTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('bad_field', 'task must be an object.');
  const raw = value as Record<string, unknown>;

  const date = text(raw.date, 'date', { max: 10 });
  if (date !== null && (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw bad('bad_date', 'date must be YYYY-MM-DD.');

  // The cover is one we stored, or nothing. Left out of the request, the task keeps the cover it has
  // (also a remote one from the content file, which the editor does not show).
  let coverUrl: string | null;
  if (raw.coverUrl === undefined) coverUrl = existing?.cover_url ?? null;
  else if (raw.coverUrl === null || raw.coverUrl === '') coverUrl = null;
  else if (typeof raw.coverUrl === 'string' && OUR_COVER.test(raw.coverUrl)) coverUrl = raw.coverUrl;
  else throw bad('bad_cover', 'Upload the cover here first.');

  if (!Array.isArray(raw.formats)) throw bad('bad_field', 'formats must be a list.');
  const formats = [...new Set(raw.formats.map((kind) => oneOf(kind, 'formats', TASK_FORMATS)))];

  const mention = text(raw.requiredMention, 'requiredMention', { max: 31 })?.replace(/^@/, '') ?? null;
  if (mention !== null && !MENTION.test(mention)) throw bad('bad_mention', 'The mention must be an Instagram handle, like @brand.');
  const hashtag = text(raw.requiredHashtag, 'requiredHashtag', { max: 61 })?.replace(/^#/, '') ?? null;
  if (hashtag !== null && !HASHTAG.test(hashtag)) throw bad('bad_hashtag', 'The hashtag must be one word: letters, numbers, underscores.');

  const startsAt = localTime(raw.startsAt, 'startsAt', false);
  const deadline = localTime(raw.deadline, 'deadline', true)!;
  if (startsAt && Date.parse(startsAt) >= Date.parse(deadline)) throw bad('bad_range', 'The start must be before the deadline.');

  return {
    title: requiredText(raw.title, 'title', { max: 120, min: 3 }),
    summary: text(raw.summary, 'summary', { max: 300 }),
    brief: text(raw.brief, 'brief', { max: 6000, multiline: true }),
    steps: stringList(raw.steps, 'steps', { maxItems: 12, maxLength: 300 }),
    place: text(raw.place, 'place', { max: 120 }),
    date,
    coverUrl,
    formats,
    requiredMention: mention,
    requiredHashtag: hashtag,
    reviewMode: oneOf(raw.reviewMode, 'reviewMode', ['post_first', 'draft_first'] as const),
    reward: requiredInt(raw.reward, 'reward', { min: 0, max: 100_000 }),
    // The mini app takes at most five links per submission.
    maxPublications: requiredInt(raw.maxPublications, 'maxPublications', { min: 1, max: 5 }),
    bonusCoins: int(raw.bonusCoins, 'bonusCoins', { min: 0, max: 1_000_000 }),
    maxParticipants: int(raw.maxParticipants, 'maxParticipants', { min: 1, max: 100_000 }),
    startsAt,
    deadline,
    audience: cleanAudience(db, raw.audience),
  };
}

// --- Writing ---------------------------------------------------------------

const FORMAT_WORDS: Record<PublicationKind, string> = { reel: 'reel', post: 'post', story: 'story', tiktok: 'TikTok', unknown: 'link' };

/** The line the mini app shows under a task, in English like the rest of the app: "Reel, post or story". */
export function formatLine(formats: PublicationKind[]): string {
  if (!formats.length) return 'Any format';
  const words = formats.map((kind) => FORMAT_WORDS[kind]);
  const line = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** A readable, unique id from the title: "Новогодний стол" becomes "novogodniy-stol". */
export function uniqueSlug(db: DB, title: string): string {
  const latin = [...title.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  const base =
    latin
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'task';
  const taken = db.prepare('SELECT 1 FROM tasks WHERE id = ?');
  if (!taken.get(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.get(candidate)) return candidate;
  }
  throw bad('slug_taken', 'Too many tasks with this title.', 409);
}

function assertPublishable(task: CleanTask): void {
  if (Date.parse(task.deadline) <= Date.now()) throw bad('deadline_past', 'The deadline has passed. Move it to publish the task.');
}

function columns(task: CleanTask): Record<string, unknown> {
  return {
    title: task.title,
    summary: task.summary,
    brief: task.brief,
    cover_url: task.coverUrl,
    reward: task.reward,
    format: formatLine(task.formats),
    formats: JSON.stringify(task.formats),
    required_mention: task.requiredMention,
    required_hashtag: task.requiredHashtag,
    date: task.date,
    place: task.place,
    starts_at: task.startsAt,
    deadline: task.deadline,
    review_mode: task.reviewMode,
    bonus_coins: task.bonusCoins,
    max_publications: task.maxPublications,
    max_participants: task.maxParticipants,
    steps: JSON.stringify(task.steps),
    audience: JSON.stringify(task.audience),
  };
}

export function createTask(db: DB, actorId: number, task: CleanTask, action: TaskAction): string {
  if (action !== 'save') assertPublishable(task);
  return db.transaction(() => {
    const id = uniqueSlug(db, task.title);
    const sort = (db.prepare('SELECT COALESCE(MIN(sort), 0) - 1 AS s FROM tasks').get() as { s: number }).s;
    const values = { ...columns(task), id, sort, status: action === 'save' ? 'draft' : 'active', created_by: actorId, at: now() };
    db.prepare(
      `INSERT INTO tasks (id, title, summary, brief, cover_url, reward, format, formats, required_mention, required_hashtag, date, place,
         starts_at, deadline, review_mode, views_bonus, bonus_coins, max_publications, max_participants, steps, sort, active, status,
         audience, source, created_by, created_at, updated_at)
       VALUES (@id, @title, @summary, @brief, @cover_url, @reward, @format, @formats, @required_mention, @required_hashtag, @date, @place,
         @starts_at, @deadline, @review_mode, 0, @bonus_coins, @max_publications, @max_participants, @steps, @sort, 1, @status,
         @audience, 'admin', @created_by, @at, @at)`,
    ).run(values);
    return id;
  })();
}

export function updateTask(db: DB, id: string, task: CleanTask, action: TaskAction): void {
  if (action !== 'save') assertPublishable(task);
  const values = { ...columns(task), id, at: now(), publish: action === 'save' ? 0 : 1 };
  // Editing a task here makes it the admin's: the content file no longer overwrites it on restart.
  db.prepare(
    `UPDATE tasks SET title = @title, summary = @summary, brief = @brief, cover_url = @cover_url, reward = @reward, format = @format,
       formats = @formats, required_mention = @required_mention, required_hashtag = @required_hashtag, date = @date, place = @place,
       starts_at = @starts_at, deadline = @deadline, review_mode = @review_mode, bonus_coins = @bonus_coins,
       max_publications = @max_publications, max_participants = @max_participants, steps = @steps, audience = @audience,
       source = 'admin', updated_at = @at,
       status = CASE WHEN @publish = 1 THEN 'active' ELSE status END,
       active = CASE WHEN @publish = 1 THEN 1 ELSE active END
     WHERE id = @id`,
  ).run(values);
}

/**
 * Announces a task in the bot once. Pressing "publish and announce" again does not message
 * the creators a second time. Returns how many were messaged, or null when it was already done.
 */
export function announceOnce(db: DB, id: string): number | null {
  const claimed = db.prepare('UPDATE tasks SET announced_at = ? WHERE id = ? AND announced_at IS NULL').run(now(), id).changes;
  if (!claimed) return null;
  applyInviteTags(db);
  return announceTask(db, id);
}

export function audienceCount(db: DB, body: Record<string, unknown>): AudienceCount {
  const audience = cleanAudience(db, body.audience);
  const reward = int(body.reward, 'reward', { min: 0, max: 100_000 }) ?? 0;
  const perCreator = int(body.maxPublications, 'maxPublications', { min: 1, max: 5 }) ?? 1;
  const limit = int(body.maxParticipants, 'maxParticipants', { min: 1, max: 100_000 });
  const bonus = int(body.bonusCoins, 'bonusCoins', { min: 0, max: 1_000_000 }) ?? 0;
  const subjects = loadSubjects(db);
  const count = reachOf(subjects, audience);
  const budgetCoins = reward * perCreator * Math.min(count, limit ?? count) + bonus;
  const rate = settings.cashout.rateKzt;
  return { count, total: subjects.length, budgetCoins, budgetMoney: rate ? budgetCoins * rate : null };
}

export function taskRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/tasks', allow(...STAFF), (c) =>
    c.json(listTaskTab(db, queryOneOf(c.req.query('tab'), ['active', 'draft', 'closed'] as const, 'active'), pageParams(c))),
  );

  api.post('/tasks/audience', allow(...STAFF), async (c) => c.json(audienceCount(db, await readJson(c))));

  api.get('/tasks/:id', allow(...STAFF), (c) => c.json(taskDetail(db, taskIdParam(c.req.param('id')))));

  api.post('/tasks', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    const action = oneOf(body.action, 'action', ['save', 'publish', 'announce'] as const);
    const actor = c.get('actor');
    const id = createTask(db, actor.id, cleanTask(db, body.task, null), action);
    audit(db, actor.id, 'task.create', id, action);
    const announced = action === 'announce' ? announceOnce(db, id) : null;
    return c.json({ task: taskDetail(db, id), announced } satisfies TaskSaved);
  });

  api.put('/tasks/:id', allow(...STAFF), async (c) => {
    const id = taskIdParam(c.req.param('id'));
    const body = await readJson(c);
    const action = oneOf(body.action, 'action', ['save', 'publish', 'announce'] as const);
    const existing = getTask(db, id);
    const actor = c.get('actor');
    updateTask(db, id, cleanTask(db, body.task, existing), action);
    audit(db, actor.id, 'task.update', id, action);
    const announced = action === 'announce' ? announceOnce(db, id) : null;
    return c.json({ task: taskDetail(db, id), announced } satisfies TaskSaved);
  });

  api.post('/tasks/:id/close', allow(...STAFF), async (c) => {
    const id = taskIdParam(c.req.param('id'));
    await readJson(c);
    getTask(db, id);
    const changed = db.prepare(`UPDATE tasks SET status = 'closed', source = 'admin', updated_at = ? WHERE id = ? AND status != 'closed'`).run(now(), id).changes;
    if (changed) audit(db, c.get('actor').id, 'task.close', id);
    return c.json(taskDetail(db, id));
  });
}
