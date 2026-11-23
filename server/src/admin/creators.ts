// Creators: the list with filters, the card, and what the team decides about a creator
// (confirm or reject the account, tags, level). Owner and Manager only.

import type { Hono } from 'hono';
import { profileOf, refreshProfile, setAccountStatus, setTags, tagsOf } from '../account.js';
import { settings } from '../config.js';
import type { DB, EntryRow, SocialProfileRow, UserRow } from '../db.js';
import { balanceOf, getUser, INVITE_LINK_NOTE, levelOf, ratingOf, setLevelOverride } from '../service.js';
import type { Level } from '../types.js';
import { audit, creatorCall, creatorCallAsync } from './audit.js';
import { allow, OWNER, RateLimiter, STAFF, type AdminEnv } from './auth.js';
import { applyInviteTags, avatarOf, CREATOR_PARAMS, CREATORS_SQL, KINDS, LEVELS, localMedia, type CreatorSqlRow } from './common.js';
import {
  bad,
  idParam,
  likePattern,
  oneOf,
  pageParams,
  parseJson,
  queryInt,
  queryOneOf,
  queryText,
  readJson,
  stringList,
  text,
} from './input.js';
import type {
  CreatorCard,
  CreatorList,
  CreatorPick,
  CreatorRow,
  CreatorSort,
  HistoryRow,
  Options,
  ProfileView,
  PublicationKind,
  RecentPostView,
  RefreshResult,
} from './types.js';

const SORTS: Record<CreatorSort, string> = {
  status: `CASE WHEN c.account_status = 'pending' THEN 0 WHEN c.profile_status = 'private' THEN 1
                WHEN c.account_status = 'rejected' THEN 2 ELSE 3 END`,
  name: 'c.first_name COLLATE NOCASE',
  followers: 'c.followers',
  avgViews: 'c.avg_reel_views',
  er: 'c.engagement_rate',
  city: 'c.city COLLATE NOCASE',
  level: `CASE c.level WHEN 'member' THEN 0 WHEN 'pro' THEN 1 ELSE 2 END`,
  rating: 'c.rating',
  joined: 'c.onboarded_at',
};

export interface CreatorQuery {
  q: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'private' | null;
  city: string | null;
  followersMin: number | null;
  followersMax: number | null;
  level: Level | null;
  tag: string | null;
  sort: CreatorSort;
  dir: 'asc' | 'desc';
}

function creatorRow(row: CreatorSqlRow, tags: string[]): CreatorRow {
  return {
    id: row.id,
    name: row.first_name,
    username: row.username,
    instagram: row.instagram,
    avatarUrl: avatarOf(row),
    followers: row.followers,
    avgReelViews: row.avg_reel_views,
    engagementRate: row.engagement_rate,
    city: row.city,
    level: row.level,
    rating: row.rating,
    tags,
    accountStatus: row.account_status,
    profileStatus: row.profile_status,
  };
}

function tagsByUser(db: DB, ids: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (!ids.length) return map;
  // One placeholder per id: the number of placeholders comes from our own list, the values are bound.
  const rows = db
    .prepare(`SELECT user_id, tag FROM user_tags WHERE user_id IN (${ids.map(() => '?').join(',')}) ORDER BY tag`)
    .all(...ids) as Array<{ user_id: number; tag: string }>;
  for (const row of rows) map.set(row.user_id, [...(map.get(row.user_id) ?? []), row.tag]);
  return map;
}

export function listCreators(db: DB, query: CreatorQuery, page: { page: number; pageSize: number; offset: number }): CreatorList {
  applyInviteTags(db);
  const where: string[] = [];
  const params: Record<string, unknown> = { ...CREATOR_PARAMS };
  if (query.q) {
    where.push(`(c.first_name LIKE @q ESCAPE '\\' OR c.username LIKE @q ESCAPE '\\' OR c.instagram LIKE @q ESCAPE '\\')`);
    params.q = likePattern(query.q.replace(/^@+/, ''));
  }
  if (query.status === 'private') where.push(`c.profile_status = 'private'`);
  else if (query.status) {
    where.push('c.account_status = @status');
    params.status = query.status;
  }
  if (query.city) {
    where.push('c.city = @city COLLATE NOCASE');
    params.city = query.city;
  }
  if (query.followersMin !== null) {
    where.push('c.followers >= @followersMin');
    params.followersMin = query.followersMin;
  }
  if (query.followersMax !== null) {
    where.push('c.followers <= @followersMax');
    params.followersMax = query.followersMax;
  }
  if (query.level) {
    where.push('c.level = @level');
    params.level = query.level;
  }
  if (query.tag) {
    where.push('EXISTS (SELECT 1 FROM user_tags ut WHERE ut.user_id = c.id AND ut.tag = @tag COLLATE NOCASE)');
    params.tag = query.tag;
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[query.sort];
  const dir = query.dir === 'desc' ? 'DESC' : 'ASC';

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${CREATORS_SQL}) c ${filter}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT * FROM (${CREATORS_SQL}) c ${filter}
       ORDER BY (${order}) IS NULL, ${order} ${dir}, c.onboarded_at DESC, c.id LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: page.pageSize, offset: page.offset }) as CreatorSqlRow[];
  const tags = tagsByUser(db, rows.map((row) => row.id));
  const summary = db
    .prepare(`SELECT COUNT(*) AS inHub, COALESCE(SUM(account_status = 'pending'), 0) AS pending FROM users WHERE onboarded_at IS NOT NULL`)
    .get() as { inHub: number; pending: number };

  return {
    rows: rows.map((row) => creatorRow(row, tags.get(row.id) ?? [])),
    total,
    page: page.page,
    pageSize: page.pageSize,
    ...summary,
  };
}

export function pickCreators(db: DB, q: string | null): CreatorPick[] {
  const rows = q
    ? db
        .prepare(
          `SELECT id, first_name, instagram FROM users WHERE onboarded_at IS NOT NULL
           AND (first_name LIKE @q ESCAPE '\\' OR username LIKE @q ESCAPE '\\' OR instagram LIKE @q ESCAPE '\\')
           ORDER BY first_name COLLATE NOCASE LIMIT 20`,
        )
        .all({ q: likePattern(q.replace(/^@+/, '')) })
    : db.prepare(`SELECT id, first_name, instagram FROM users WHERE onboarded_at IS NOT NULL ORDER BY onboarded_at DESC LIMIT 20`).all();
  return (rows as Array<{ id: number; first_name: string; instagram: string | null }>).map((row) => ({
    id: row.id,
    name: row.first_name,
    instagram: row.instagram,
  }));
}

export function options(db: DB): Options {
  const cities = new Map<string, string>();
  for (const city of settings.cities) cities.set(city.toLowerCase(), city);
  for (const row of db.prepare(`SELECT DISTINCT city FROM users WHERE onboarded_at IS NOT NULL AND city IS NOT NULL`).all() as Array<{ city: string }>) {
    if (!cities.has(row.city.toLowerCase())) cities.set(row.city.toLowerCase(), row.city);
  }
  const tags = (db.prepare('SELECT DISTINCT tag FROM user_tags ORDER BY tag').all() as Array<{ tag: string }>).map((row) => row.tag);
  return { cities: [...cities.values()].sort((a, b) => a.localeCompare(b)), tags };
}

function recentPosts(json: string): RecentPostView[] {
  const list = parseJson<unknown>(json, []);
  if (!Array.isArray(list)) return [];
  const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 12)
    .map((item) => ({
      kind: (KINDS as readonly unknown[]).includes(item.kind) ? (item.kind as PublicationKind) : 'unknown',
      publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : null,
      views: num(item.views),
      likes: num(item.likes),
      comments: num(item.comments),
      url: typeof item.url === 'string' && /^https:\/\//.test(item.url) ? item.url : '',
    }));
}

function profileView(row: SocialProfileRow | undefined): ProfileView | null {
  if (!row) return null;
  return {
    handle: row.handle,
    fullName: row.full_name,
    bio: row.bio,
    followers: row.followers,
    following: row.following,
    postsCount: row.posts_count,
    avgReelViews: row.avg_reel_views,
    engagementRate: row.engagement_rate,
    isPrivate: Boolean(row.is_private),
    isVerified: Boolean(row.is_verified),
    status: row.status,
    source: row.source,
    fetchedAt: row.fetched_at,
    recent: recentPosts(row.recent),
  };
}

function history(db: DB, userId: number): HistoryRow[] {
  const entries = db
    .prepare(
      `SELECT e.*, t.title AS task_title, t.reward AS task_reward FROM entries e JOIN tasks t ON t.id = e.task_id
       WHERE e.user_id = ? ORDER BY COALESCE(e.submitted_at, e.joined_at) DESC LIMIT 50`,
    )
    .all(userId) as Array<EntryRow & { task_title: string; task_reward: number }>;
  const pubs = db
    .prepare('SELECT entry_id, kind, status, views_source, story_views FROM publications WHERE user_id = ? ORDER BY id')
    .all(userId) as Array<{ entry_id: number; kind: PublicationKind; status: string; views_source: string; story_views: number | null }>;
  return entries.map((entry) => {
    const own = pubs.filter((pub) => pub.entry_id === entry.id);
    const measuring: HistoryRow['measuring'] = !own.length
      ? 'none'
      : own.some((pub) => pub.status === 'removed')
        ? 'removed'
        : own.every((pub) => pub.status === 'final')
          ? 'final'
          : 'tracking';
    return {
      entryId: entry.id,
      taskId: entry.task_id,
      taskTitle: entry.task_title,
      status: entry.status,
      kinds: [...new Set(own.map((pub) => pub.kind))],
      measuring,
      views: entry.views,
      statedViews: own.reduce((sum, pub) => sum + (pub.views_source === 'creator' ? (pub.story_views ?? 0) : 0), 0),
      coins: entry.status === 'approved' ? (entry.reward ?? entry.task_reward) : entry.task_reward,
      paid: entry.status === 'approved',
      approvedAt: entry.approved_at,
      submittedAt: entry.submitted_at,
    };
  });
}

function getCreator(db: DB, id: number): UserRow {
  const user = getUser(db, id);
  if (!user) throw bad('not_found', 'This creator does not exist.', 404);
  return user;
}

export function creatorCard(db: DB, id: number): CreatorCard {
  applyInviteTags(db);
  const user = getCreator(db, id);
  const instagram = profileOf(db, id, 'instagram');
  const rating = ratingOf(db, id);
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS publications, COALESCE(SUM(views), 0) AS views, AVG(score) AS score
       FROM entries WHERE user_id = ? AND status = 'approved'`,
    )
    .get(id) as { publications: number; views: number; score: number | null };
  const invite = db.prepare('SELECT note FROM invites WHERE telegram_id = ?').get(id) as { note: string | null } | undefined;
  const payout = db.prepare('SELECT details FROM cashouts WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(id) as
    | { details: string }
    | undefined;
  const wallet = db
    .prepare('SELECT id, title, kind, amount, created_at AS createdAt FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 10')
    .all(id) as CreatorCard['wallet'];

  return {
    id: user.id,
    name: user.first_name,
    username: user.username,
    instagram: user.instagram,
    tiktok: user.tiktok,
    city: user.city,
    avatarUrl: localMedia(user.avatar_url) ?? localMedia(instagram?.avatar_url),
    joinedAt: user.onboarded_at,
    invitedVia: invite ? (invite.note === INVITE_LINK_NOTE ? 'link' : 'list') : null,
    accountStatus: user.account_status,
    accountNote: user.account_note,
    accountReviewedAt: user.account_reviewed_at,
    level: levelOf(user, rating),
    levelOverride: user.level_override,
    rating,
    tags: tagsOf(db, id),
    instagramProfile: profileView(instagram),
    tiktokProfile: profileView(profileOf(db, id, 'tiktok')),
    history: history(db, id),
    hub: {
      publications: stats.publications,
      views: stats.views,
      teamScore: stats.score === null ? null : Math.round(stats.score * 10) / 10,
      balance: balanceOf(db, id),
    },
    wallet,
    details: {
      size: user.size,
      address: user.address,
      phone: user.phone,
      birthDate: user.birth_date,
      payoutDetails: payout?.details ?? null,
    },
  };
}

/** A refresh asks the data provider (it costs money): once a minute per creator is plenty. */
const refreshLimit = new RateLimiter(1, 60 * 1000);
/** How long the request waits for the provider before answering "still working on it". */
const REFRESH_WAIT_MS = 15_000;

export function creatorRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/creators', allow(...STAFF), (c) => {
    const level = c.req.query('level');
    const status = c.req.query('status');
    const query: CreatorQuery = {
      q: queryText(c.req.query('q'), 60),
      status: status && ['pending', 'confirmed', 'rejected', 'private'].includes(status) ? (status as CreatorQuery['status']) : null,
      city: queryText(c.req.query('city'), 80),
      followersMin: queryInt(c.req.query('followersMin')),
      followersMax: queryInt(c.req.query('followersMax')),
      level: level && (LEVELS as readonly string[]).includes(level) ? (level as Level) : null,
      tag: queryText(c.req.query('tag'), 30),
      sort: queryOneOf(c.req.query('sort'), Object.keys(SORTS) as CreatorSort[], 'status'),
      dir: queryOneOf(c.req.query('dir'), ['asc', 'desc'] as const, 'asc'),
    };
    return c.json(listCreators(db, query, pageParams(c)));
  });

  api.get('/creators/pick', allow(...STAFF), (c) => c.json(pickCreators(db, queryText(c.req.query('q'), 60))));
  api.get('/options', allow(...STAFF), (c) => c.json(options(db)));

  api.get('/creators/:id', allow(...STAFF), (c) => c.json(creatorCard(db, idParam(c.req.param('id')))));

  api.post('/creators/:id/account', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const status = oneOf(body.status, 'status', ['confirmed', 'rejected'] as const);
    const note = text(body.note, 'note', { max: 500, multiline: true, required: status === 'rejected' });
    const user = getCreator(db, id);
    if (!user.onboarded_at) throw bad('not_onboarded', 'This person has not finished joining the Hub yet.', 409);
    // Pressing the button twice must not message the creator twice.
    if (user.account_status !== status) {
      creatorCall('setAccountStatus', () => setAccountStatus(db, id, status, c.get('actor').id, note));
      audit(db, c.get('actor').id, 'creator.account', id, status);
    }
    return c.json(creatorCard(db, id));
  });

  api.post('/creators/:id/refresh', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    getCreator(db, id);
    if (!refreshLimit.hit(String(id))) throw bad('too_soon', 'This profile was refreshed a moment ago. Try again in a minute.', 429);
    audit(db, c.get('actor').id, 'creator.refresh', id);
    const state = await creatorCallAsync('refreshProfile', async () => {
      const work = refreshProfile(db, id).then(() => 'done' as const);
      let timer: NodeJS.Timeout | undefined;
      const slow = new Promise<'pending'>((resolve) => {
        timer = setTimeout(() => resolve('pending'), REFRESH_WAIT_MS);
      });
      try {
        const first = await Promise.race([work, slow]);
        // A slow refresh keeps running; its failure must not become an unhandled rejection.
        if (first === 'pending') work.catch((error: Error) => console.error(`[admin] refreshProfile failed: ${error?.name ?? 'Error'}`));
        return first;
      } finally {
        clearTimeout(timer);
      }
    });
    return c.json({ state } satisfies RefreshResult);
  });

  api.put('/creators/:id/tags', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const tags = stringList(body.tags, 'tags', { maxItems: 20, maxLength: 30 });
    getCreator(db, id);
    const saved = setTags(db, id, tags);
    audit(db, c.get('actor').id, 'creator.tags', id, `${saved.length} tags`);
    return c.json(creatorCard(db, id));
  });

  api.put('/creators/:id/level', allow(...OWNER), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const level = body.level === null ? null : oneOf(body.level, 'level', LEVELS);
    getCreator(db, id);
    setLevelOverride(db, id, level);
    audit(db, c.get('actor').id, 'creator.level', id, level ?? 'auto');
    return c.json(creatorCard(db, id));
  });
}
