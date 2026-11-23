// Invitations: a list of Telegram usernames or ids (with optional tags), and the shared
// invite link, through the same service functions the bot commands use.

import type { Hono } from 'hono';
import { now, type DB } from '../db.js';
import { addInvite, disableInviteLink, INVITE_LINK_NOTE, INVITE_LINK_PREFIX, inviteLinkCode, resetInviteLink } from '../service.js';
import { audit } from './audit.js';
import { allow, memberName, STAFF, type AdminEnv } from './auth.js';
import { adminBotUsername } from './bot.js';
import { applyInviteTags } from './common.js';
import { bad, oneOf, parseJson, readJson, text } from './input.js';
import type { InviteLinkState, InviteResult, InviteRow, Invitations, InviteState } from './types.js';

const CHANGED_AT = 'admin_invite_link_changed_at';
/** Telegram usernames are 5 to 32 characters; older ones can be 4. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const TELEGRAM_ID = /^[1-9]\d{2,14}$/;

function linkState(db: DB): InviteLinkState {
  const code = inviteLinkCode(db);
  const bot = adminBotUsername();
  const joined = (db.prepare('SELECT COUNT(*) AS n FROM invites WHERE note = ?').get(INVITE_LINK_NOTE) as { n: number }).n;
  const changed = db.prepare('SELECT value FROM meta WHERE key = ?').get(CHANGED_AT) as { value: string } | undefined;
  const start = code ? `${INVITE_LINK_PREFIX}${code}` : null;
  return {
    on: Boolean(code),
    link: start ? (bot ? `https://t.me/${bot}?start=${start}` : `?start=${start}`) : null,
    joined,
    changedAt: changed?.value ?? null,
  };
}

function recent(db: DB): InviteRow[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.telegram_id, i.username, i.note, i.invited_by, i.created_at, u.id AS user_id, u.onboarded_at, u.account_status
       FROM invites i LEFT JOIN users u ON u.id = i.telegram_id ORDER BY i.id DESC LIMIT 50`,
    )
    .all() as Array<{
    id: number;
    telegram_id: number | null;
    username: string | null;
    note: string | null;
    invited_by: number | null;
    created_at: string;
    user_id: number | null;
    onboarded_at: string | null;
    account_status: 'pending' | 'confirmed' | 'rejected' | null;
  }>;
  return rows.map((row) => {
    const state: InviteState = !row.user_id ? 'not_opened' : !row.onboarded_at ? 'started' : (row.account_status ?? 'pending');
    return {
      id: row.id,
      who: row.username ? `@${row.username}` : String(row.telegram_id),
      via: row.note === INVITE_LINK_NOTE ? 'link' : 'list',
      by: row.invited_by ? memberName(db, row.invited_by) : null,
      createdAt: row.created_at,
      state,
    };
  });
}

/** Splits what the team pasted into usernames and ids. Anything else is reported back as invalid. */
export function parseRefs(list: string): Array<{ ref: string; valid: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ ref: string; valid: boolean }> = [];
  for (const raw of list.split(/[\s,;]+/)) {
    const ref = raw.trim().replace(/^@+/, '').replace(/^https?:\/\/t\.me\//i, '');
    if (!ref || seen.has(ref.toLowerCase())) continue;
    seen.add(ref.toLowerCase());
    out.push({ ref, valid: USERNAME.test(ref) || (TELEGRAM_ID.test(ref) && Number.isSafeInteger(Number(ref))) });
  }
  return out;
}

export function invite(db: DB, actorId: number, list: string, tagText: string | null): InviteResult {
  const refs = parseRefs(list);
  if (!refs.length) throw bad('list_required', 'Add at least one @username or Telegram id.');
  if (refs.length > 100) throw bad('too_many', 'At most 100 people at once.');
  const tags = tagText
    ? [...new Set(tagText.split(',').map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 10)
    : [];

  const results: InviteResult['results'] = [];
  db.transaction(() => {
    for (const { ref, valid } of refs) {
      if (!valid) {
        results.push({ ref, result: 'invalid' });
        continue;
      }
      const result = addInvite(db, ref);
      const byId = TELEGRAM_ID.test(ref);
      const row = db.prepare(`SELECT id, tags FROM invites WHERE ${byId ? 'telegram_id' : 'username'} = ?`).get(byId ? Number(ref) : ref) as
        | { id: number; tags: string | null }
        | undefined;
      if (row && result === 'added') db.prepare('UPDATE invites SET invited_by = ? WHERE id = ?').run(actorId, row.id);
      if (row && tags.length) {
        const merged = [...new Set([...parseJson<string[]>(row.tags, []), ...tags])].slice(0, 20);
        db.prepare('UPDATE invites SET tags = ?, tags_applied_at = NULL WHERE id = ?').run(JSON.stringify(merged), row.id);
      }
      results.push({ ref: byId ? ref : `@${ref}`, result });
    }
  })();
  // People who are already in the Hub get their tags straight away.
  applyInviteTags(db);
  return { results };
}

export function inviteRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/invites', allow(...STAFF), (c) => c.json({ link: linkState(db), recent: recent(db) } satisfies Invitations));

  api.post('/invites', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    const list = text(body.list, 'list', { max: 5000, multiline: true, required: true })!;
    const tags = text(body.tags, 'tags', { max: 300 });
    const result = invite(db, c.get('actor').id, list, tags);
    const added = result.results.filter((r) => r.result === 'added').length;
    audit(db, c.get('actor').id, 'invite.add', null, `${added} added of ${result.results.length}`);
    return c.json(result);
  });

  api.post('/invites/link', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    const action = oneOf(body.action, 'action', ['on', 'replace', 'off'] as const);
    const markChanged = () =>
      db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(CHANGED_AT, now());
    if (action === 'off') {
      if (disableInviteLink(db)) markChanged();
    } else if (action === 'replace' || !inviteLinkCode(db)) {
      resetInviteLink(db);
      markChanged();
    }
    // The code itself is a secret of sorts: the log says what happened, never the code.
    audit(db, c.get('actor').id, 'invite.link', null, action);
    return c.json(linkState(db));
  });
}
