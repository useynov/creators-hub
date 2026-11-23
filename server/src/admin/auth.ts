// Who may use the admin site, and how they prove it.
//
// - A team member sends /admin to the bot in private and gets a one-time link (5 minutes).
// - Opening the link exchanges the token for a session cookie (7 days, rolling, at most 30 days).
// - Only SHA-256 hashes of both tokens are stored, so a copy of the database opens nothing.
// - The role is read fresh on every request: ADMIN_IDS are always Owner, everyone else comes
//   from team_members. Demo mode (team.ts) is deliberately ignored here.

import { getConnInfo } from '@hono/node-server/conninfo';
import { createHash, randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config, isAdmin } from '../config.js';
import { now, type DB, type TeamMemberRow } from '../db.js';
import { bad } from './input.js';
import type { TeamRole } from './types.js';

export const LOGIN_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A rolling session still ends this long after the login. */
export const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** How often an active session is extended (and the cookie sent again). */
const ROLL_EVERY_MS = 5 * 60 * 1000;

export const ROLES: readonly TeamRole[] = ['owner', 'manager', 'viewer'];
/** 32 random bytes in base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');
const iso = (ms: number): string => new Date(ms).toISOString();

export interface Actor {
  id: number;
  role: TeamRole;
  name: string;
  /** Hash of the session token, to end exactly this session on logout. */
  session: string;
}

export type AdminEnv = { Variables: { actor: Actor } };

// --- Roles -----------------------------------------------------------------

/** The role of a Telegram account on the admin site, or null when they are not on the team. */
export function roleOf(db: DB, telegramId: number): TeamRole | null {
  if (isAdmin(telegramId)) return 'owner';
  const row = db.prepare('SELECT role FROM team_members WHERE telegram_id = ?').get(telegramId) as { role: string } | undefined;
  return row && (ROLES as readonly string[]).includes(row.role) ? (row.role as TeamRole) : null;
}

export function memberName(db: DB, telegramId: number): string {
  const member = db.prepare('SELECT name FROM team_members WHERE telegram_id = ?').get(telegramId) as Pick<TeamMemberRow, 'name'> | undefined;
  if (member) return member.name;
  const user = db.prepare('SELECT first_name FROM users WHERE id = ?').get(telegramId) as { first_name: string } | undefined;
  return user?.first_name ?? `ID ${telegramId}`;
}

// --- One-time login links --------------------------------------------------

/**
 * Makes a login token for a team member. Any earlier unused token of theirs stops working,
 * so only the latest link in the chat opens the site. Returns the token itself (only the
 * hash is stored).
 */
export function issueLoginToken(db: DB, telegramId: number, nowMs = Date.now()): string {
  const token = newToken();
  db.transaction(() => {
    db.prepare('DELETE FROM admin_logins WHERE expires_at < ? OR used_at IS NOT NULL').run(iso(nowMs - LOGIN_TTL_MS));
    db.prepare('DELETE FROM admin_logins WHERE telegram_id = ? AND used_at IS NULL').run(telegramId);
    db.prepare('INSERT INTO admin_logins (token_hash, telegram_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      sha256(token),
      telegramId,
      iso(nowMs),
      iso(nowMs + LOGIN_TTL_MS),
    );
  })();
  return token;
}

/**
 * Uses up a login token. Returns the Telegram id it was made for, or null when the token is
 * unknown, used, expired, or its owner is no longer on the team. Every failure looks the same.
 */
export function consumeLoginToken(db: DB, token: unknown, nowMs = Date.now()): number | null {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  const hash = sha256(token);
  return db.transaction(() => {
    const row = db.prepare('SELECT telegram_id, expires_at FROM admin_logins WHERE token_hash = ? AND used_at IS NULL').get(hash) as
      | { telegram_id: number; expires_at: string }
      | undefined;
    if (!row) return null;
    // Single use: whatever happens next, this token is spent.
    db.prepare('UPDATE admin_logins SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(iso(nowMs), hash);
    if (Date.parse(row.expires_at) <= nowMs) return null;
    if (!roleOf(db, row.telegram_id)) return null;
    return row.telegram_id;
  })();
}

/** The one-time login link the bot sends. The token is base64url, safe in a URL as it is. */
export const loginUrl = (token: string): string => `${config.webappUrl}/admin/login?token=${token}`;

// --- Sessions --------------------------------------------------------------

export function createSession(db: DB, telegramId: number, userAgent: string | undefined, nowMs = Date.now()): string {
  const token = newToken();
  db.prepare(
    'INSERT INTO admin_sessions (token_hash, telegram_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(sha256(token), telegramId, iso(nowMs), iso(nowMs + SESSION_TTL_MS), iso(nowMs), (userAgent ?? '').slice(0, 200) || null);
  return token;
}

interface SessionRow {
  token_hash: string;
  telegram_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
}

export function findSession(db: DB, token: string | undefined, nowMs = Date.now()): SessionRow | null {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const row = db.prepare('SELECT * FROM admin_sessions WHERE token_hash = ?').get(sha256(token)) as SessionRow | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= nowMs || Date.parse(row.created_at) + SESSION_MAX_MS <= nowMs) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return row;
}

/** Extends an active session. Returns true when the cookie should be sent again. */
function rollSession(db: DB, row: SessionRow, nowMs: number): boolean {
  if (row.last_seen_at && nowMs - Date.parse(row.last_seen_at) < ROLL_EVERY_MS) return false;
  const expires = Math.min(nowMs + SESSION_TTL_MS, Date.parse(row.created_at) + SESSION_MAX_MS);
  db.prepare('UPDATE admin_sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?').run(iso(expires), iso(nowMs), row.token_hash);
  db.prepare('UPDATE team_members SET last_seen_at = ? WHERE telegram_id = ?').run(iso(nowMs), row.telegram_id);
  return true;
}

/** Ends every session and every unused login link of a person: their role changed or they left. */
export function endSessionsOf(db: DB, telegramId: number): number {
  db.prepare('DELETE FROM admin_logins WHERE telegram_id = ? AND used_at IS NULL').run(telegramId);
  return db.prepare('DELETE FROM admin_sessions WHERE telegram_id = ?').run(telegramId).changes;
}

// --- Cookie ----------------------------------------------------------------

/** Plain http is only allowed for a local preview. Everywhere else the cookie is Secure. */
export function isLocalRequest(c: Context): boolean {
  const host = new URL(c.req.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** `__Host-` makes the browser refuse the cookie unless it is Secure, host-only and Path=/. */
const cookieName = (c: Context): string => (isLocalRequest(c) ? 'ch_admin' : '__Host-ch_admin');

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, cookieName(c));
}

export function writeSessionCookie(c: Context, token: string, maxAgeMs = SESSION_TTL_MS): void {
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: !isLocalRequest(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, cookieName(c), { path: '/', secure: !isLocalRequest(c), httpOnly: true, sameSite: 'Strict' });
}

// --- Middleware ------------------------------------------------------------

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'creators-hub-admin';

/**
 * Mutating requests must carry a header a browser never adds to a cross-site request
 * (setting it forces a CORS preflight, which we never answer) and a JSON or multipart body.
 * A form post from another site can do neither. Origin and Sec-Fetch-Site, when the browser
 * sends them, must also say "same site".
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  if (c.req.header(CSRF_HEADER) !== CSRF_VALUE) throw bad('csrf', 'This request is not allowed.', 403);
  const type = (c.req.header('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json') && !type.startsWith('multipart/form-data')) {
    throw bad('csrf', 'This request is not allowed.', 403);
  }
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin') throw bad('csrf', 'This request is not allowed.', 403);
  const origin = c.req.header('origin');
  if (origin) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === new URL(c.req.url).host;
    } catch {
      sameHost = false;
    }
    if (!sameHost) throw bad('csrf', 'This request is not allowed.', 403);
  }
  return next();
};

/** Every route after this one needs a live session of someone who is still on the team. */
export function sessionGuard(db: DB): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const nowMs = Date.now();
    const row = findSession(db, readSessionCookie(c), nowMs);
    if (!row) throw bad('unauthorized', 'Sign in again: send /admin to the bot.', 401);
    const role = roleOf(db, row.telegram_id);
    if (!role) {
      endSessionsOf(db, row.telegram_id);
      clearSessionCookie(c);
      throw bad('unauthorized', 'Sign in again: send /admin to the bot.', 401);
    }
    if (rollSession(db, row, nowMs)) {
      const left = Math.min(SESSION_TTL_MS, Date.parse(row.created_at) + SESSION_MAX_MS - nowMs);
      writeSessionCookie(c, readSessionCookie(c)!, left);
    }
    c.set('actor', { id: row.telegram_id, role, name: memberName(db, row.telegram_id), session: row.token_hash });
    return next();
  };
}

/**
 * The one place where roles are checked. Every admin route is declared with the roles it
 * allows; anyone else gets 403. Nothing is allowed by default.
 */
export function allow(...roles: TeamRole[]): MiddlewareHandler<AdminEnv> {
  if (!roles.length) throw new Error('allow() needs at least one role');
  return async (c, next) => {
    const actor = c.get('actor');
    if (!actor || !roles.includes(actor.role)) throw bad('forbidden', 'Your role does not allow this.', 403);
    return next();
  };
}

export const OWNER: TeamRole[] = ['owner'];
export const STAFF: TeamRole[] = ['owner', 'manager'];
export const EVERYONE: TeamRole[] = ['owner', 'manager', 'viewer'];

// --- Rate limits -----------------------------------------------------------

/** Fixed-window counter in memory. Bounded: old windows are dropped, and so is the oldest key when full. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
    private maxKeys = 10_000,
  ) {}

  /** Counts one attempt. False when the key is over its limit for this window. */
  hit(key: string, nowMs = Date.now()): boolean {
    let slot = this.hits.get(key);
    if (!slot || nowMs - slot.start >= this.windowMs) {
      if (!slot && this.hits.size >= this.maxKeys) this.prune(nowMs);
      slot = { start: nowMs, count: 0 };
      this.hits.set(key, slot);
    }
    slot.count += 1;
    return slot.count <= this.limit;
  }

  reset(): void {
    this.hits.clear();
  }

  private prune(nowMs: number): void {
    for (const [key, slot] of this.hits) if (nowMs - slot.start >= this.windowMs) this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
  }
}

const isPrivateAddress = (address: string): boolean => {
  const ip = address.replace(/^::ffff:/i, '');
  if (ip === '::1' || ip.startsWith('127.')) return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(ip)) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
};

/**
 * The client's address for rate limiting. X-Forwarded-For is believed only when the direct
 * peer is our own reverse proxy on a private network (Caddy in deploy/compose.yaml sets it).
 */
export function clientIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    peer = undefined; // no socket: an in-process request (tests)
  }
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded && (!peer || isPrivateAddress(peer))) {
    const last = forwarded.split(',').map((part) => part.trim()).filter(Boolean).pop();
    if (last) return last.slice(0, 64);
  }
  return peer ?? 'unknown';
}

export const loginLimits = {
  perIp: new RateLimiter(10, 15 * 60 * 1000),
  /** All addresses together: a spoofed address still cannot try without end. */
  global: new RateLimiter(300, 15 * 60 * 1000),
};

/** Development preview only: never in production, only with DEV_USER_ID. */
export const devLoginEnabled = (): boolean => !config.isProd && config.devUserId !== null;

/** For the dev login: make sure DEV_USER_ID can be an Owner on this local database. */
export function ensureDevOwner(db: DB): number {
  const id = config.devUserId;
  if (!devLoginEnabled() || id === null) throw bad('not_found', 'Not found.', 404);
  if (!isAdmin(id)) {
    db.prepare(
      `INSERT INTO team_members (telegram_id, name, role, created_at) VALUES (?, 'Dev owner', 'owner', ?)
       ON CONFLICT(telegram_id) DO UPDATE SET role = 'owner'`,
    ).run(id, now());
  }
  return id;
}
