// Signing in and out, and who is signed in.

import type { Hono } from 'hono';
import { settings } from '../config.js';
import type { DB } from '../db.js';
import { audit } from './audit.js';
import {
  allow,
  clearSessionCookie,
  clientIp,
  consumeLoginToken,
  createSession,
  devLoginEnabled,
  ensureDevOwner,
  EVERYONE,
  loginLimits,
  readSessionCookie,
  sha256,
  writeSessionCookie,
  type AdminEnv,
} from './auth.js';
import { adminBotUsername } from './bot.js';
import { bad, oneOf, readJson } from './input.js';
import type { AdminMe, Counters, LoginInfo } from './types.js';

/** Stories whose numbers need the team: stated and not yet looked at, or still missing two days on. */
export const STORIES_TO_CHECK_SQL = `
  p.kind = 'story' AND p.status != 'removed' AND (
    (p.story_answered_at IS NOT NULL AND p.story_checked_at IS NULL)
    OR (p.story_views IS NULL AND julianday(p.created_at) <= julianday('now', '-2 days')))`;

export function counters(db: DB): Counters {
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    pendingAccounts: count(`SELECT COUNT(*) AS n FROM users WHERE onboarded_at IS NOT NULL AND account_status = 'pending'`),
    review:
      count(`SELECT COUNT(*) AS n FROM entries WHERE status IN ('in_review', 'draft_review')`) +
      count(`SELECT COUNT(*) AS n FROM publications p WHERE ${STORIES_TO_CHECK_SQL}`),
    newOrders: count(`SELECT COUNT(*) AS n FROM orders WHERE status = 'new'`),
    payoutRequests: count(`SELECT COUNT(*) AS n FROM cashouts WHERE status = 'new'`),
  };
}

/** Routes that work without a session: the login page's facts, the login itself, the dev login. */
export function publicRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/auth/info', (c) => c.json({ botUsername: adminBotUsername(), devLogin: devLoginEnabled() } satisfies LoginInfo));

  api.post('/auth/login', async (c) => {
    // Count every attempt, good or bad, per address and in total.
    const underIp = loginLimits.perIp.hit(clientIp(c));
    const underAll = loginLimits.global.hit('all');
    if (!underIp || !underAll) throw bad('too_many', 'Too many attempts. Wait a few minutes and try again.', 429);
    const body = await readJson(c);
    const telegramId = consumeLoginToken(db, body.token);
    if (telegramId === null) {
      throw bad('login_invalid', 'This link has expired or was already used. Send /admin to the bot for a new one.', 401);
    }
    startSession(c, db, telegramId);
    audit(db, telegramId, 'auth.login', telegramId);
    return c.json({ ok: true });
  });

  // Local preview only: the route does not exist in production or without DEV_USER_ID.
  if (devLoginEnabled()) {
    api.post('/auth/dev', async (c) => {
      const body = await readJson(c);
      const as = body.as === undefined ? 'owner' : oneOf(body.as, 'as', ['owner', 'manager', 'viewer'] as const);
      let telegramId: number;
      if (as === 'owner') telegramId = ensureDevOwner(db);
      else {
        const row = db.prepare('SELECT telegram_id FROM team_members WHERE role = ? ORDER BY telegram_id LIMIT 1').get(as) as
          | { telegram_id: number }
          | undefined;
        if (!row) throw bad('not_found', `No ${as} in the preview data.`, 404);
        telegramId = row.telegram_id;
      }
      startSession(c, db, telegramId);
      audit(db, telegramId, 'auth.dev_login', telegramId);
      return c.json({ ok: true });
    });
  }
}

function startSession(c: Parameters<typeof writeSessionCookie>[0], db: DB, telegramId: number): void {
  // A fresh token every time; a session this browser had before ends here.
  const previous = readSessionCookie(c);
  if (previous) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(previous));
  writeSessionCookie(c, createSession(db, telegramId, c.req.header('user-agent')));
}

export function meRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/me', allow(...EVERYONE), (c) => {
    const actor = c.get('actor');
    const me: AdminMe = {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      counters: actor.role === 'viewer' ? null : counters(db),
      settings: {
        brandName: settings.brandName,
        timeZone: settings.timeZone,
        currencySign: settings.currencySign,
        cities: settings.cities,
        cashout: settings.cashout,
        metricsHours: settings.metrics.scheduleHours,
      },
      botUsername: adminBotUsername(),
    };
    return c.json(me);
  });

  api.post('/auth/logout', allow(...EVERYONE), (c) => {
    const actor = c.get('actor');
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(actor.session);
    clearSessionCookie(c);
    audit(db, actor.id, 'auth.logout', actor.id);
    return c.json({ ok: true });
  });
}
