// Small pieces several admin screens share: the computed rating and level in SQL, who a task
// reaches, local media addresses and the hub's wall-clock time.

import { parseAudience, matchesAudience, type Audience, type AudienceSubject } from '../audience.js';
import { settings } from '../config.js';
import { now, type DB } from '../db.js';
import type { Level } from '../types.js';
import { parseJson } from './input.js';
import type { PublicationKind } from './types.js';

export const KINDS: readonly PublicationKind[] = ['reel', 'post', 'story', 'tiktok', 'unknown'];
export const TASK_FORMATS: readonly PublicationKind[] = ['reel', 'post', 'story', 'tiktok'];
export const LEVELS: readonly Level[] = ['member', 'pro', 'partner'];

/**
 * Creators with their rating and level, computed the same way as ratingOf and levelOf in
 * service.ts, so lists can filter and sort by them in SQL. Use as a FROM source:
 * `SELECT ... FROM (${CREATORS_SQL}) c`, with CREATOR_PARAMS spread into the named parameters.
 */
export const CREATORS_SQL = `
  SELECT u.id, u.first_name, u.username, u.instagram, u.city, u.avatar_url, u.account_status, u.level_override,
         u.onboarded_at, p.followers, p.avg_reel_views, p.engagement_rate, p.status AS profile_status,
         p.avatar_url AS profile_avatar, COALESCE(s.rating, 0) AS rating,
         CASE WHEN u.level_override IN ('member', 'pro', 'partner') THEN u.level_override
              WHEN COALESCE(s.rating, 0) >= @levelPartner THEN 'partner'
              WHEN COALESCE(s.rating, 0) >= @levelPro THEN 'pro'
              ELSE 'member' END AS level
  FROM users u
  LEFT JOIN social_profiles p ON p.user_id = u.id AND p.platform = 'instagram'
  LEFT JOIN (
    SELECT e.user_id,
           -- better-sqlite3 binds numbers as REAL: cast, so views count in whole points like Math.floor in ratingOf.
           CAST(COUNT(*) * @perPublication + COALESCE(SUM(e.score), 0) * @perScorePoint
             + CAST(COALESCE(SUM(e.views), 0) / @viewsPerPoint AS INTEGER) AS INTEGER) AS rating
    FROM entries e WHERE e.status = 'approved' GROUP BY e.user_id
  ) s ON s.user_id = u.id
  WHERE u.onboarded_at IS NOT NULL`;

export const CREATOR_PARAMS = {
  levelPartner: settings.levels.partner,
  levelPro: settings.levels.pro,
  perPublication: Math.round(settings.rating.perPublication),
  perScorePoint: Math.round(settings.rating.perScorePoint),
  viewsPerPoint: Math.max(1, Math.round(settings.rating.viewsPerPoint)),
};

export interface CreatorSqlRow {
  id: number;
  first_name: string;
  username: string | null;
  instagram: string | null;
  city: string | null;
  avatar_url: string | null;
  account_status: 'pending' | 'confirmed' | 'rejected';
  level_override: Level | null;
  onboarded_at: string;
  followers: number | null;
  avg_reel_views: number | null;
  engagement_rate: number | null;
  profile_status: 'ok' | 'private' | 'not_found' | 'error' | null;
  profile_avatar: string | null;
  rating: number;
  level: Level;
}

const LOCAL_MEDIA = /^\/media\/[a-z]+\/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/;
const RELATIVE_MEDIA = /^[a-z]+\/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/;

/**
 * An image address the admin site may show: only our own public media. Remote addresses
 * (Instagram's CDN, the content file) are never loaded by the admin: they expire, and they
 * would tell other sites who is looking.
 */
export function localMedia(value: string | null | undefined): string | null {
  if (!value) return null;
  if (LOCAL_MEDIA.test(value)) return value;
  if (RELATIVE_MEDIA.test(value)) return `/media/${value}`;
  return null;
}

export const avatarOf = (row: { avatar_url: string | null; profile_avatar?: string | null }): string | null =>
  localMedia(row.avatar_url) ?? localMedia(row.profile_avatar ?? null);

export function formatsOf(json: string | null | undefined): PublicationKind[] {
  const list = parseJson<unknown>(json, []);
  return Array.isArray(list) ? list.filter((kind): kind is PublicationKind => (KINDS as readonly unknown[]).includes(kind)) : [];
}

// --- Audience --------------------------------------------------------------

/** Everyone a task can reach: creators in the Hub whose account is not rejected. */
export function loadSubjects(db: DB): AudienceSubject[] {
  applyInviteTags(db);
  const rows = db
    .prepare(`SELECT id, city, level, followers FROM (${CREATORS_SQL}) c WHERE account_status != 'rejected'`)
    .all(CREATOR_PARAMS) as Array<{ id: number; city: string | null; level: Level; followers: number | null }>;
  const tags = new Map<number, string[]>();
  for (const row of db.prepare('SELECT user_id, tag FROM user_tags').all() as Array<{ user_id: number; tag: string }>) {
    const list = tags.get(row.user_id) ?? [];
    list.push(row.tag);
    tags.set(row.user_id, list);
  }
  return rows.map((row) => ({ id: row.id, city: row.city, level: row.level, followers: row.followers, tags: tags.get(row.id) ?? [] }));
}

export function reachOf(subjects: AudienceSubject[], audience: Audience): number {
  return subjects.reduce((count, subject) => count + (matchesAudience(subject, audience) ? 1 : 0), 0);
}

export const audienceOf = (json: string | null | undefined): Audience => parseAudience(json);

/**
 * Tags chosen when someone was invited from the admin site are put on them once they show up
 * in the Hub. Runs whenever the admin reads creators or audiences. Safe to call any time.
 */
export function applyInviteTags(db: DB): void {
  const waiting = db
    .prepare(
      `SELECT i.id, i.telegram_id, i.tags FROM invites i JOIN users u ON u.id = i.telegram_id
       WHERE i.tags IS NOT NULL AND i.tags_applied_at IS NULL`,
    )
    .all() as Array<{ id: number; telegram_id: number; tags: string }>;
  if (!waiting.length) return;
  const insert = db.prepare('INSERT OR IGNORE INTO user_tags (user_id, tag) VALUES (?, ?)');
  const done = db.prepare('UPDATE invites SET tags_applied_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of waiting) {
      const tags = parseJson<unknown>(row.tags, []);
      if (Array.isArray(tags)) {
        for (const tag of tags) if (typeof tag === 'string' && tag) insert.run(row.telegram_id, tag.slice(0, 30).toLowerCase());
      }
      done.run(now(), row.id);
    }
  })();
}

// --- Time ------------------------------------------------------------------

function zonedParts(ms: number): { y: number; m: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** An ISO instant as wall-clock time in the hub's zone: YYYY-MM-DDTHH:mm. */
export function toLocalInput(isoValue: string | null): string | null {
  if (!isoValue) return null;
  const ms = Date.parse(isoValue);
  if (!Number.isFinite(ms)) return null;
  const p = zonedParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Wall-clock time in the hub's zone (YYYY-MM-DDTHH:mm) as a UTC ISO instant, or null when it is not a real time. */
export function fromLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d, h, mi] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || y < 2000 || y > 2100) return null;
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== m - 1) return null;
  const offsetAt = (ms: number): number => {
    const p = zonedParts(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return new Date(guess).toISOString();
}
