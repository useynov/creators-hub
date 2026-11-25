// The team and their roles. Owner only. Owners from ADMIN_IDS are fixed: they cannot be
// demoted or removed here. Any change of someone's role, or removing them, ends their sessions.

import type { Hono } from 'hono';
import { config, settings } from '../config.js';
import { now, type DB, type TeamMemberRow } from '../db.js';
import { syncMenu } from '../menus.js';
import { esc, notifyUser } from '../notify.js';
import { findUser } from '../service.js';
import { audit } from './audit.js';
import { allow, endSessionsOf, memberName, OWNER, ROLES, type AdminEnv } from './auth.js';
import { bad, idParam, oneOf, readJson, requiredText } from './input.js';
import type { TeamRole, TeamRow } from './types.js';

const ROLE_WORD: Record<TeamRole, string> = { owner: 'Owner', manager: 'Manager', viewer: 'Viewer' };

function lastSeen(db: DB, telegramId: number, stored: string | null): string | null {
  const row = db.prepare('SELECT MAX(last_seen_at) AS at FROM admin_sessions WHERE telegram_id = ?').get(telegramId) as { at: string | null };
  return [stored, row.at].filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;
}

export function listTeam(db: DB, me: number): TeamRow[] {
  const members = db.prepare('SELECT * FROM team_members ORDER BY created_at').all() as TeamMemberRow[];
  const fixed: TeamRow[] = config.adminIds.map((id) => {
    const user = db.prepare('SELECT first_name, username FROM users WHERE id = ?').get(id) as { first_name: string; username: string | null } | undefined;
    return {
      telegramId: id,
      name: user?.first_name ?? memberName(db, id),
      username: user?.username ?? null,
      role: 'owner',
      fixed: true,
      lastSeenAt: lastSeen(db, id, null),
      isMe: id === me,
    };
  });
  const rest: TeamRow[] = members
    .filter((member) => !config.adminIds.includes(member.telegram_id))
    .map((member) => ({
      telegramId: member.telegram_id,
      name: member.name,
      username: member.username,
      role: member.role,
      fixed: false,
      lastSeenAt: lastSeen(db, member.telegram_id, member.last_seen_at),
      isMe: member.telegram_id === me,
    }));
  return [...fixed, ...rest];
}

/** A Telegram id or @username of someone who has started the bot. */
const REF = /^@?([A-Za-z][A-Za-z0-9_]{3,31}|[1-9]\d{2,14})$/;

export function addMember(db: DB, actorId: number, ref: string, role: TeamRole): void {
  if (!REF.test(ref)) throw bad('bad_ref', 'Enter a Telegram @username or numeric id.');
  const user = findUser(db, ref);
  if (!user) throw bad('not_started', 'This person has not started the bot yet. Ask them to press Start first.', 404);
  if (config.adminIds.includes(user.id)) throw bad('already_owner', 'This person is already an Owner.', 409);
  if (db.prepare('SELECT 1 FROM team_members WHERE telegram_id = ?').get(user.id)) throw bad('already_member', 'This person is already on the team.', 409);
  db.prepare('INSERT INTO team_members (telegram_id, name, username, role, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    user.id,
    user.first_name.slice(0, 80),
    user.username,
    role,
    actorId,
    now(),
  );
  audit(db, actorId, 'team.add', user.id, role);
  // Their "/" list in the bot now shows the commands of the new role.
  void syncMenu(db, user.id);
  void notifyUser(
    user.id,
    `You now have access to the ${esc(settings.brandName)} admin site as ${ROLE_WORD[role]}. Send /admin to me to sign in.`,
  );
}

function editable(db: DB, actorId: number, telegramId: number): TeamMemberRow {
  if (config.adminIds.includes(telegramId)) throw bad('fixed_owner', 'Owners from the server settings cannot be changed here.', 403);
  if (telegramId === actorId) throw bad('not_yourself', 'Ask another Owner to change your own role.', 403);
  const member = db.prepare('SELECT * FROM team_members WHERE telegram_id = ?').get(telegramId) as TeamMemberRow | undefined;
  if (!member) throw bad('not_found', 'This person is not on the team.', 404);
  return member;
}

export function changeRole(db: DB, actorId: number, telegramId: number, role: TeamRole): void {
  const member = editable(db, actorId, telegramId);
  if (member.role === role) return;
  db.transaction(() => {
    db.prepare('UPDATE team_members SET role = ? WHERE telegram_id = ?').run(role, telegramId);
    // New rights start with a new sign-in.
    endSessionsOf(db, telegramId);
    audit(db, actorId, 'team.role', telegramId, `${member.role} → ${role}`);
  })();
  void syncMenu(db, telegramId);
}

export function removeMember(db: DB, actorId: number, telegramId: number): void {
  editable(db, actorId, telegramId);
  db.transaction(() => {
    db.prepare('DELETE FROM team_members WHERE telegram_id = ?').run(telegramId);
    endSessionsOf(db, telegramId);
    audit(db, actorId, 'team.remove', telegramId);
  })();
  void syncMenu(db, telegramId);
}

export function teamRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/team', allow(...OWNER), (c) => c.json(listTeam(db, c.get('actor').id)));

  api.post('/team', allow(...OWNER), async (c) => {
    const body = await readJson(c);
    const ref = requiredText(body.ref, 'ref', { max: 40 });
    addMember(db, c.get('actor').id, ref, oneOf(body.role, 'role', ROLES));
    return c.json(listTeam(db, c.get('actor').id));
  });

  api.patch('/team/:id', allow(...OWNER), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    changeRole(db, c.get('actor').id, id, oneOf(body.role, 'role', ROLES));
    return c.json(listTeam(db, c.get('actor').id));
  });

  api.delete('/team/:id', allow(...OWNER), async (c) => {
    const id = idParam(c.req.param('id'));
    await readJson(c);
    removeMember(db, c.get('actor').id, id);
    return c.json(listTeam(db, c.get('actor').id));
  });
}
