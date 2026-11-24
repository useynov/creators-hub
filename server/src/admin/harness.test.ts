// Shared setup for the admin tests. Imported first by every admin test file: it sets the
// environment before anything reads the config. Holds no tests of its own.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-admin-test-'));
delete process.env.DEV_USER_ID;
delete process.env.ADMIN_CHAT_ID;

const dbModule = await import('../db.js');
const { createApp } = await import('../http.js');
const auth = await import('./auth.js');

export const { now } = dbModule;
export type DB = import('../db.js').DB;
export type App = ReturnType<typeof createApp>;

export const OWNER_ID = 900;
export const MANAGER_ID = 901;
export const VIEWER_ID = 902;

export function setup(): { db: DB; app: App } {
  const db = dbModule.openDb(':memory:');
  dbModule.syncContent(db);
  const app = createApp(db, () => 'test_bot');
  auth.loginLimits.perIp.reset();
  auth.loginLimits.global.reset();
  return { db, app };
}

export function addMember(db: DB, id: number, role: 'owner' | 'manager' | 'viewer', name = `Member ${id}`): void {
  db.prepare(`INSERT OR IGNORE INTO users (id, username, first_name, created_at) VALUES (?, ?, ?, ?)`).run(id, `member${id}`, name, now());
  db.prepare(`INSERT OR REPLACE INTO team_members (telegram_id, name, role, created_at) VALUES (?, ?, ?, ?)`).run(id, name, role, now());
}

export interface CreatorOptions {
  name?: string;
  instagram?: string;
  city?: string;
  status?: 'pending' | 'confirmed' | 'rejected';
  followers?: number | null;
  address?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  tags?: string[];
}

export function addCreator(db: DB, id: number, options: CreatorOptions = {}): void {
  db.prepare(
    `INSERT INTO users (id, username, first_name, instagram, city, address, phone, birth_date, account_status, onboarded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `user${id}`,
    options.name ?? `Creator ${id}`,
    options.instagram ?? `creator.${id}`,
    options.city ?? 'Almaty',
    options.address ?? null,
    options.phone ?? null,
    // A member of the Hub has answered the age question; without a date they would still be in setup.
    options.birthDate === undefined ? '1995-05-05' : options.birthDate,
    options.status ?? 'confirmed',
    now(),
    now(),
  );
  db.prepare('INSERT INTO invites (telegram_id, created_at) VALUES (?, ?)').run(id, now());
  if (options.followers !== null) {
    db.prepare(
      `INSERT INTO social_profiles (user_id, platform, handle, followers, avg_reel_views, engagement_rate, fetched_at)
       VALUES (?, 'instagram', ?, ?, 1000, 5.5, ?)`,
    ).run(id, options.instagram ?? `creator.${id}`, options.followers ?? 2000, now());
  }
  for (const tag of options.tags ?? []) db.prepare('INSERT INTO user_tags (user_id, tag) VALUES (?, ?)').run(id, tag);
}

/** Signs a team member in through the real login link and returns the Cookie header to send. */
export async function login(app: App, db: DB, telegramId: number, origin = 'http://localhost'): Promise<string> {
  const token = auth.issueLoginToken(db, telegramId);
  const response = await app.request(`${origin}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin' },
    body: JSON.stringify({ token }),
  });
  if (response.status !== 200) throw new Error(`login failed: ${response.status}`);
  return cookieFrom(response)!;
}

/** The session cookie a response sets, as a Cookie header value. */
export function cookieFrom(response: Response): string | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  return header.split(';')[0]!;
}

export interface Answer<T> {
  status: number;
  data: T;
  headers: Headers;
}

/** Calls the admin API the way the site does: JSON body and the CSRF header on every mutation. */
export async function call<T = any>(
  app: App,
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Answer<T>> {
  const mutating = method !== 'GET';
  const response = await app.request(`http://localhost${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(mutating ? { 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin' } : {}),
      ...extraHeaders,
    },
    body: mutating ? JSON.stringify(body ?? {}) : undefined,
  });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data: data as T, headers: response.headers };
}

export { auth };
