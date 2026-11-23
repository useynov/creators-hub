import { config, isAdmin } from './config.js';
import type { DB } from './db.js';

/**
 * Who counts as the team.
 *
 * The owners are the ADMIN_IDS from the environment. Owners and Managers added on the admin
 * site's Team screen work in the bot too (Viewers only read reports on the site). In demo mode everyone on
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

/** The role someone was given on the admin site's Team screen, if any. */
function memberRole(db: DB, telegramId: number): 'owner' | 'manager' | 'viewer' | null {
  const row = db.prepare('SELECT role FROM team_members WHERE telegram_id = ?').get(telegramId) as { role: 'owner' | 'manager' | 'viewer' } | undefined;
  return row?.role ?? null;
}

/** Owners: the ADMIN_IDS from the environment, and people made Owner on the admin site. */
export function isOwner(db: DB, telegramId: number): boolean {
  return isAdmin(telegramId) || memberRole(db, telegramId) === 'owner';
}

/**
 * A Manager from the admin site who is not an owner. In the bot they review, confirm accounts,
 * invite and announce like the rest of the team, but do not hand out coins, levels or paid offers:
 * the same line the admin site draws.
 */
export function isManagerOnly(db: DB, telegramId: number): boolean {
  return !isAdmin(telegramId) && memberRole(db, telegramId) === 'manager';
}

export function isTeam(db: DB, telegramId: number): boolean {
  if (isAdmin(telegramId)) return true;
  const role = memberRole(db, telegramId);
  if (role === 'owner' || role === 'manager') return true;
  return demoMode(db) && Boolean(db.prepare('SELECT 1 FROM invites WHERE telegram_id = ?').get(telegramId));
}

/** The chats where the team works: one group, or each team member in private. Viewers get nothing. */
export function teamChats(db: DB): number[] {
  if (config.adminChatId) return [config.adminChatId];
  const ids = new Set(config.adminIds);
  const staff = db.prepare(`SELECT telegram_id FROM team_members WHERE role IN ('owner', 'manager')`).all() as Array<{ telegram_id: number }>;
  for (const row of staff) ids.add(row.telegram_id);
  if (demoMode(db)) {
    const rows = db.prepare('SELECT telegram_id FROM invites WHERE telegram_id IS NOT NULL').all() as Array<{ telegram_id: number }>;
    for (const row of rows) ids.add(row.telegram_id);
  }
  return [...ids].filter((id) => !isQuiet(db, id));
}
