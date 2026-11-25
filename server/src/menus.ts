// The list Telegram shows when someone types "/" in a chat with the bot.
//
// Telegram keeps one list per "scope". Creators get the default one. Each person on the team
// gets their own list in their private chat with the bot, holding every command their role may
// use, and the team group gets the commands that make sense there. A command in a list is only a
// shortcut: who may run it is still decided by the bot when the command arrives.

import type { Api } from 'grammy';
import { config, isAdmin } from './config.js';
import type { DB } from './db.js';
import { demoMode, isOwner, isTeam } from './team.js';

/** Who sees a command, from everyone up to the owners named in the server settings. */
export type Tier = 'creator' | 'viewer' | 'team' | 'owner' | 'root';
const RANK: Record<Tier, number> = { creator: 0, viewer: 1, team: 2, owner: 3, root: 4 };

interface MenuCommand {
  command: string;
  /** Shown next to the command. Telegram cuts long lines on a phone, so keep it short. */
  description: string;
  /** The lowest role that sees it. */
  from: Tier;
  /** Works in a private chat only, so it is left out of the team group's list. */
  privateOnly?: boolean;
}

/**
 * Every command of the bot, in the order the list shows them. A new command belongs here too:
 * menus.test.ts fails when a command the bot answers is missing.
 */
export const COMMANDS: MenuCommand[] = [
  { command: 'start', description: 'Open the Hub', from: 'creator', privateOnly: true },
  { command: 'admin', description: 'Sign in to the admin site', from: 'viewer', privateOnly: true },
  { command: 'pending', description: 'Work waiting for review', from: 'team' },
  { command: 'tasks', description: 'Tasks and their IDs', from: 'team' },
  { command: 'announce', description: 'Tell creators about a task', from: 'team' },
  { command: 'views', description: 'Set the views of an approved post', from: 'team' },
  { command: 'confirm', description: "Confirm a creator's account", from: 'team' },
  { command: 'reject', description: "Reject a creator's account", from: 'team' },
  { command: 'invite', description: 'Add creators to the invite list', from: 'team' },
  { command: 'uninvite', description: 'Remove from the invite list', from: 'team' },
  { command: 'invites', description: 'Show the invite list', from: 'team' },
  { command: 'invitelink', description: 'The shared invite link', from: 'team' },
  { command: 'bonus', description: 'Add or take coins by hand', from: 'owner' },
  { command: 'level', description: "Set a creator's level by hand", from: 'owner' },
  { command: 'offer', description: 'Send a paid offer', from: 'owner' },
  { command: 'allowage', description: 'Lift an age refusal', from: 'owner' },
  { command: 'sampledata', description: 'Sample creators: on or off', from: 'owner' },
  { command: 'demo', description: 'Demo mode: on or off', from: 'root' },
  { command: 'startover', description: 'Remove my creator account, start again', from: 'owner', privateOnly: true },
  { command: 'quiet', description: 'Team messages to me: on or off', from: 'team', privateOnly: true },
  { command: 'cancel', description: 'Drop the answer I was asked to write', from: 'team' },
  { command: 'clear', description: 'Clear this chat', from: 'creator', privateOnly: true },
  { command: 'id', description: 'Show this chat ID and my ID', from: 'team' },
  { command: 'help', description: 'All team commands with examples', from: 'team' },
];

type Listed = Array<{ command: string; description: string }>;
const strip = (list: MenuCommand[]): Listed => list.map(({ command, description }) => ({ command, description }));

/** What one role sees in their private chat with the bot. */
export const privateMenu = (tier: Tier): Listed => strip(COMMANDS.filter((entry) => RANK[entry.from] <= RANK[tier]));

/** What the team group sees: the team's and owners' commands that work in a group. */
export const groupMenu = (): Listed => strip(COMMANDS.filter((entry) => !entry.privateOnly && RANK[entry.from] <= RANK.owner));

/** The role that decides someone's list. Follows the same checks the commands themselves make. */
export function tierOf(db: DB, telegramId: number): Tier {
  if (isAdmin(telegramId)) return 'root';
  if (isOwner(db, telegramId)) return 'owner';
  if (isTeam(db, telegramId)) return 'team';
  const viewer = db.prepare(`SELECT 1 FROM team_members WHERE telegram_id = ? AND role = 'viewer'`).get(telegramId);
  return viewer ? 'viewer' : 'creator';
}

// The chats that have a list of their own, kept so it can be taken away again when someone
// leaves the team, also after a restart.
const KEY = 'menu_chats';
function personal(db: DB): Set<number> {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as { value: string } | undefined;
  try {
    return new Set((JSON.parse(row?.value ?? '[]') as unknown[]).filter((id): id is number => Number.isInteger(id)));
  } catch {
    return new Set();
  }
}
function remember(db: DB, ids: Set<number>): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify([...ids]));
}

/** What this process last set for a chat, so the same list is not sent to Telegram twice. */
const applied = new Map<number, Tier>();

let api: Api | null = null;
/** The bot's connection to Telegram. Without one (tests, local preview) nothing is sent. */
export function setMenuApi(next: Api | null): void {
  api = next;
  applied.clear();
}

/**
 * Gives one person the list their role calls for, or takes their own list away when they are a
 * creator again. Telegram refuses a list for someone who has never opened the bot; that is tried
 * again the next time they write.
 */
export async function syncMenu(db: DB, telegramId: number): Promise<void> {
  if (!api) return;
  const tier = tierOf(db, telegramId);
  const scope = { type: 'chat' as const, chat_id: telegramId };
  try {
    if (tier === 'creator') {
      const ids = personal(db);
      if (!ids.has(telegramId) && !applied.has(telegramId)) return;
      await api.deleteMyCommands({ scope });
      applied.delete(telegramId);
      if (ids.delete(telegramId)) remember(db, ids);
      return;
    }
    if (applied.get(telegramId) === tier) return;
    await api.setMyCommands(privateMenu(tier), { scope });
    applied.set(telegramId, tier);
    const ids = personal(db);
    if (!ids.has(telegramId)) remember(db, ids.add(telegramId));
  } catch (error) {
    console.warn(`[menu] could not set the command list for ${telegramId}:`, (error as Error).message);
  }
}

/** The whole picture: creators' list, the team group's, and one for each person on the team. */
export async function syncAllMenus(db: DB): Promise<void> {
  if (!api) return;
  try {
    await api.setMyCommands(privateMenu('creator'));
    if (config.adminChatId !== null) await api.setMyCommands(groupMenu(), { scope: { type: 'chat', chat_id: config.adminChatId } });
  } catch (error) {
    console.warn('[menu] could not set the command list:', (error as Error).message);
  }
  const ids = new Set<number>([...config.adminIds, ...personal(db)]);
  for (const row of db.prepare('SELECT telegram_id FROM team_members').all() as Array<{ telegram_id: number }>) ids.add(row.telegram_id);
  if (demoMode(db)) {
    for (const row of db.prepare('SELECT telegram_id FROM invites WHERE telegram_id IS NOT NULL').all() as Array<{ telegram_id: number }>) ids.add(row.telegram_id);
  }
  for (const id of ids) await syncMenu(db, id);
}
