import { config, isAdmin } from './config.js';
import type { DB } from './db.js';

/**
 * Who counts as the team.
 *
 * The owners are the ADMIN_IDS from the environment. In demo mode everyone on
 * the invite list joins them: they get the team commands, the review buttons
 * and the team's messages. That lets a group of testers try both sides of the
 * Hub on their own, without an owner reviewing for them. Never leave it on with
 * real creators in the Hub.
 */
const flag = (db: DB, key: string): boolean => Boolean(db.prepare('SELECT 1 FROM meta WHERE key = ?').get(key));

function setFlag(db: DB, key: string, on: boolean): void {
  if (on) db.prepare(`INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING`).run(key);
  else db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}

export const demoMode = (db: DB): boolean => flag(db, 'demo_mode');
export const setDemoMode = (db: DB, on: boolean): void => setFlag(db, 'demo_mode', on);

/** A team member who asked not to get the team's messages in private. */
export const isQuiet = (db: DB, telegramId: number): boolean => flag(db, `quiet:${telegramId}`);
export const setQuiet = (db: DB, telegramId: number, on: boolean): void => setFlag(db, `quiet:${telegramId}`, on);

export function isTeam(db: DB, telegramId: number): boolean {
  if (isAdmin(telegramId)) return true;
  return demoMode(db) && Boolean(db.prepare('SELECT 1 FROM invites WHERE telegram_id = ?').get(telegramId));
}

/** The chats where the team works: one group, or each team member in private. */
export function teamChats(db: DB): number[] {
  if (config.adminChatId) return [config.adminChatId];
  const ids = new Set(config.adminIds);
  if (demoMode(db)) {
    const rows = db.prepare('SELECT telegram_id FROM invites WHERE telegram_id IS NOT NULL').all() as Array<{ telegram_id: number }>;
    for (const row of rows) ids.add(row.telegram_id);
  }
  return [...ids].filter((id) => !isQuiet(db, id));
}
