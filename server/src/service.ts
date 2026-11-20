import { randomBytes } from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config, isAdmin, settings } from './config.js';
import {
  now,
  type DB,
  type EntryRow,
  type EventRow,
  type OfferRow,
  type ShopItemRow,
  type TaskRow,
  type UserRow,
} from './db.js';
import { esc, notifyAdmins, notifyUser } from './notify.js';
import type {
  EntryView,
  EventsView,
  EventView,
  HomeView,
  LeaderboardView,
  Level,
  Me,
  NewsView,
  OfferView,
  PublicSettings,
  ShopView,
  TaskView,
  WalletView,
} from './types.js';

export class HubError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const LEVELS: Level[] = ['member', 'pro', 'partner'];
const levelRank = (level: Level): number => LEVELS.indexOf(level);
export const levelName = (level: Level): string => level[0]!.toUpperCase() + level.slice(1);

// --- Time ---------------------------------------------------------------

function zonedParts(date: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

/** Today's date in the hub's time zone, as YYYY-MM-DD. */
export function localDate(date = new Date()): string {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The instant the current month started in the hub's time zone, as UTC ISO. */
export function monthStart(date = new Date()): string {
  const p = zonedParts(date);
  const wallClockAsUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  const offset = wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year!, p.month! - 1, 1) - offset).toISOString();
}

function shortDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${isoDate.slice(0, 10)}T00:00:00Z`),
  );
}

// --- People -------------------------------------------------------------

export interface TelegramIdentity {
  id: number;
  first_name: string;
  username?: string;
}

/**
 * True when this Telegram account is on the invite list. An invite made by
 * @username is bound to the numeric id the first time that account shows up.
 */
export function isInvited(db: DB, tg: TelegramIdentity): boolean {
  if (isAdmin(tg.id)) return true;
  if (db.prepare('SELECT 1 FROM invites WHERE telegram_id = ?').get(tg.id)) return true;
  if (!tg.username) return false;
  const byName = db
    .prepare('SELECT id FROM invites WHERE username = ? AND telegram_id IS NULL')
    .get(tg.username) as { id: number } | undefined;
  if (!byName) return false;
  db.prepare('UPDATE invites SET telegram_id = ? WHERE id = ?').run(tg.id, byName.id);
  return true;
}

export function upsertUser(db: DB, tg: TelegramIdentity): UserRow {
  db.prepare(
    `INSERT INTO users (id, username, first_name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name`,
  ).run(tg.id, tg.username ?? null, tg.first_name, now());
  return getUser(db, tg.id)!;
}

export function getUser(db: DB, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

/** Finds a creator by numeric id or @username, for the admin commands. */
export function findUser(db: DB, ref: string): UserRow | undefined {
  const clean = ref.trim().replace(/^@/, '');
  if (/^\d+$/.test(clean)) return getUser(db, Number(clean));
  return db.prepare('SELECT * FROM users WHERE username = ?').get(clean) as UserRow | undefined;
}

export function addInvite(db: DB, ref: string, note?: string): 'added' | 'exists' {
  const clean = ref.trim().replace(/^@/, '');
  const byId = /^\d+$/.test(clean);
  const column = byId ? 'telegram_id' : 'username';
  const value = byId ? Number(clean) : clean;
  if (db.prepare(`SELECT 1 FROM invites WHERE ${column} = ?`).get(value)) return 'exists';
  db.prepare(`INSERT INTO invites (${column}, note, created_at) VALUES (?, ?, ?)`).run(value, note ?? null, now());
  return 'added';
}

export function removeInvite(db: DB, ref: string): boolean {
  const clean = ref.trim().replace(/^@/, '');
  const result = /^\d+$/.test(clean)
    ? db.prepare('DELETE FROM invites WHERE telegram_id = ?').run(Number(clean))
    : db.prepare('DELETE FROM invites WHERE username = ?').run(clean);
  return result.changes > 0;
}

// --- Invite link --------------------------------------------------------

/** The shared invite link is t.me/<bot>?start=join_<code>. */
export const INVITE_LINK_PREFIX = 'join_';
/** Marks invite-list rows that came in through the link. */
export const INVITE_LINK_NOTE = 'invite link';

/** The code of the shared invite link, or null while the link is off. */
export function inviteLinkCode(db: DB): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'invite_link_code'`).get() as { value: string } | undefined;
  return row?.value ?? null;
}

/** Makes a fresh code. Any earlier link stops letting new people in. */
export function resetInviteLink(db: DB): string {
  const code = randomBytes(9).toString('base64url');
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('invite_link_code', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(code);
  return code;
}

/** Turns the link off. People who already came in through it stay on the list. */
export function disableInviteLink(db: DB): boolean {
  return db.prepare(`DELETE FROM meta WHERE key = 'invite_link_code'`).run().changes > 0;
}

/**
 * Lets in whoever opens the bot through the live invite link by putting the
 * account on the invite list. False when the code is not the current one.
 */
export function redeemInviteLink(db: DB, tg: TelegramIdentity, code: string): boolean {
  if (isInvited(db, tg)) return true;
  const live = inviteLinkCode(db);
  if (!live || code !== live) return false;
  addInvite(db, String(tg.id), INVITE_LINK_NOTE);
  return true;
}

export function balanceOf(db: DB, userId: number): number {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE user_id = ?').get(userId) as {
    total: number;
  };
  return row.total;
}

interface Stats {
  publications: number;
  views: number;
  scoreSum: number;
}

function statsOf(db: DB, userId: number): Stats {
  return db
    .prepare(
      `SELECT COUNT(*) AS publications, COALESCE(SUM(views), 0) AS views, COALESCE(SUM(score), 0) AS scoreSum
       FROM entries WHERE user_id = ? AND status = 'approved'`,
    )
    .get(userId) as Stats;
}

/** Rating grows with publications, the team's score for each, and views. */
export function ratingOf(db: DB, userId: number): number {
  const stats = statsOf(db, userId);
  const weights = settings.rating;
  return (
    stats.publications * weights.perPublication +
    stats.scoreSum * weights.perScorePoint +
    Math.floor(stats.views / weights.viewsPerPoint)
  );
}

export function levelOf(user: UserRow, rating: number): Level {
  if (user.level_override) return user.level_override;
  if (rating >= settings.levels.partner) return 'partner';
  if (rating >= settings.levels.pro) return 'pro';
  return 'member';
}

/** Tells the creator when they have climbed a level since we last looked. */
function syncLevel(db: DB, userId: number): void {
  const user = getUser(db, userId);
  if (!user) return;
  const level = levelOf(user, ratingOf(db, userId));
  if (level === user.level) return;
  db.prepare('UPDATE users SET level = ? WHERE id = ?').run(level, userId);
  if (levelRank(level) < levelRank(user.level)) return;
  const perk = level === 'pro' ? 'Cash-out is open for you.' : 'Paid offers are open for you.';
  void notifyUser(userId, `<b>You are now ${levelName(level)}.</b> ${perk}`, {
    text: 'See what opened',
    path: '/levels',
  });
}

export function setLevelOverride(db: DB, userId: number, level: Level | null): void {
  db.prepare('UPDATE users SET level_override = ? WHERE id = ?').run(level, userId);
  syncLevel(db, userId);
}

interface Standing {
  user_id: number;
  views: number;
  instagram: string | null;
  first_name: string;
}

function standings(db: DB, period: 'month' | 'all'): Standing[] {
  const since = period === 'month' ? monthStart() : '';
  return db
    .prepare(
      `SELECT e.user_id, SUM(e.views) AS views, u.instagram, u.first_name
       FROM entries e JOIN users u ON u.id = e.user_id
       WHERE e.status = 'approved' AND e.approved_at >= ?
       GROUP BY e.user_id ORDER BY views DESC, MIN(e.approved_at) ASC`,
    )
    .all(since) as Standing[];
}

export function leaderboard(db: DB, userId: number, period: 'month' | 'all'): LeaderboardView {
  const rows = standings(db, period);
  const mine = rows.findIndex((row) => row.user_id === userId);
  return {
    period,
    me: mine >= 0 ? { rank: mine + 1, views: rows[mine]!.views } : null,
    top: rows.slice(0, 20).map((row, index) => ({
      rank: index + 1,
      handle: row.instagram ? `@${row.instagram}` : row.first_name,
      views: row.views,
      isMe: row.user_id === userId,
    })),
  };
}

export function buildMe(db: DB, user: UserRow): Me {
  const stats = statsOf(db, user.id);
  const rating = ratingOf(db, user.id);
  const level = levelOf(user, rating);
  const nextLevel = level === 'member' ? 'pro' : level === 'pro' ? 'partner' : null;
  const nextThreshold = nextLevel ? settings.levels[nextLevel] : null;
  const rank = standings(db, 'month').findIndex((row) => row.user_id === user.id);
  return {
    id: user.id,
    firstName: user.first_name,
    username: user.username,
    instagram: user.instagram,
    tiktok: user.tiktok,
    city: user.city,
    size: user.size,
    address: user.address,
    phone: user.phone,
    onboarded: Boolean(user.onboarded_at),
    balance: balanceOf(db, user.id),
    rating,
    level,
    nextLevel,
    nextThreshold,
    progress: nextThreshold ? Math.min(1, rating / nextThreshold) : 1,
    stats: {
      publications: stats.publications,
      views: stats.views,
      teamScore: stats.publications ? Math.round((stats.scoreSum / stats.publications) * 10) / 10 : null,
    },
    rank: rank >= 0 ? rank + 1 : null,
  };
}

export function publicSettings(botUsername: string | null): PublicSettings {
  return {
    brandName: settings.brandName,
    brandInitials: settings.brandInitials,
    botUsername,
    communityChatUrl: config.communityChatUrl,
    timeZone: settings.timeZone,
    currencySign: settings.currencySign,
    reviewTime: settings.reviewTime,
    cities: settings.cities,
    levels: settings.levels,
    cashout: settings.cashout,
    topPerformerBonus: settings.topPerformerBonus,
    checkinCoins: settings.checkinCoins,
  };
}

const handle = (value: unknown): string | null => {
  const clean = String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, '')
    .replace(/[/?].*$/, '');
  return clean ? clean.slice(0, 60) : null;
};
const text = (value: unknown, max: number): string | null => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : null;
};

export function completeSetup(db: DB, user: UserRow, body: Record<string, unknown>): void {
  const instagram = handle(body.instagram);
  const city = text(body.city, 80);
  if (!instagram) throw new HubError('instagram_required', 'Add your Instagram handle.');
  if (!city) throw new HubError('city_required', 'Choose your city.');
  db.prepare('UPDATE users SET instagram = ?, tiktok = ?, city = ?, onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?').run(
    instagram,
    handle(body.tiktok),
    city,
    now(),
    user.id,
  );
}

export function updateDetails(db: DB, user: UserRow, body: Record<string, unknown>): void {
  const next = {
    instagram: 'instagram' in body ? handle(body.instagram) ?? user.instagram : user.instagram,
    tiktok: 'tiktok' in body ? handle(body.tiktok) : user.tiktok,
    city: 'city' in body ? text(body.city, 80) ?? user.city : user.city,
    size: 'size' in body ? text(body.size, 8) : user.size,
    address: 'address' in body ? text(body.address, 300) : user.address,
    phone: 'phone' in body ? text(body.phone, 30) : user.phone,
  };
  db.prepare('UPDATE users SET instagram = ?, tiktok = ?, city = ?, size = ?, address = ?, phone = ? WHERE id = ?').run(
    next.instagram,
    next.tiktok,
    next.city,
    next.size,
    next.address,
    next.phone,
    user.id,
  );
}

// --- Tasks --------------------------------------------------------------

function entryView(entry: EntryRow): EntryView {
  return {
    id: entry.id,
    status: entry.status,
    joinedAt: entry.joined_at,
    links: JSON.parse(entry.links) as string[],
    note: entry.note,
    submittedAt: entry.submitted_at,
    draftLink: entry.draft_link,
    draftSentAt: entry.draft_sent_at,
    draftApprovedAt: entry.draft_approved_at,
    comment: entry.comment,
    commentAt: entry.comment_at,
    approvedAt: entry.approved_at,
    reward: entry.reward,
    ratingDelta: entry.rating_delta,
    views: entry.views,
  };
}

const isClosed = (task: TaskRow): boolean => !task.active || new Date(task.deadline).getTime() < Date.now();

function taskView(task: TaskRow, entry: EntryRow | undefined): TaskView {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    coverUrl: task.cover_url,
    reward: task.reward,
    format: task.format,
    date: task.date,
    place: task.place,
    deadline: task.deadline,
    closed: isClosed(task),
    reviewMode: task.review_mode,
    viewsBonus: Boolean(task.views_bonus),
    steps: JSON.parse(task.steps) as string[],
    entry: entry ? entryView(entry) : null,
  };
}

function getTask(db: DB, taskId: string): TaskRow {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw new HubError('task_not_found', 'This task does not exist.', 404);
  return task;
}

function getEntry(db: DB, userId: number, taskId: string): EntryRow | undefined {
  return db.prepare('SELECT * FROM entries WHERE user_id = ? AND task_id = ?').get(userId, taskId) as
    | EntryRow
    | undefined;
}

function getEntryById(db: DB, entryId: number): EntryRow {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId) as EntryRow | undefined;
  if (!entry) throw new HubError('entry_not_found', 'This submission does not exist.', 404);
  return entry;
}

/** Every task the creator can see: open ones, plus any they already took part in. */
export function listTasks(db: DB, userId: number): TaskView[] {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY active DESC, sort ASC, deadline ASC').all() as TaskRow[];
  const entries = db.prepare('SELECT * FROM entries WHERE user_id = ?').all(userId) as EntryRow[];
  const byTask = new Map(entries.map((entry) => [entry.task_id, entry]));
  return tasks
    .map((task) => taskView(task, byTask.get(task.id)))
    .filter((task) => task.entry || !task.closed);
}

export function oneTask(db: DB, userId: number, taskId: string): TaskView {
  return taskView(getTask(db, taskId), getEntry(db, userId, taskId));
}

function assertOpen(task: TaskRow): void {
  if (isClosed(task)) throw new HubError('task_closed', 'The deadline for this task has passed.');
}

function ensureEntry(db: DB, userId: number, task: TaskRow): EntryRow {
  const existing = getEntry(db, userId, task.id);
  if (existing) return existing;
  db.prepare(`INSERT INTO entries (user_id, task_id, status, joined_at) VALUES (?, ?, 'joined', ?)`).run(
    userId,
    task.id,
    now(),
  );
  return getEntry(db, userId, task.id)!;
}

export function joinTask(db: DB, user: UserRow, taskId: string): TaskView {
  const task = getTask(db, taskId);
  if (!getEntry(db, user.id, taskId)) {
    assertOpen(task);
    ensureEntry(db, user.id, task);
    void notifyAdmins(`${creatorLine(user)} is in for <b>${esc(task.title)}</b>.`);
  }
  return oneTask(db, user.id, taskId);
}

function cleanLinks(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [input];
  const links: string[] = [];
  for (const item of raw) {
    let value = String(item ?? '').trim();
    if (!value) continue;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (!url.hostname.includes('.')) throw new Error('no host');
      links.push(url.toString().slice(0, 500));
    } catch {
      throw new HubError('bad_link', 'That does not look like a link. Copy it from the app and paste it here.');
    }
  }
  if (!links.length) throw new HubError('link_required', 'Paste the link to your post.');
  return links.slice(0, 5);
}

export function creatorLine(user: UserRow): string {
  const parts = [`<b>${esc(user.first_name)}</b>`];
  if (user.username) parts.push(`@${esc(user.username)}`);
  if (user.instagram) parts.push(`IG <a href="https://instagram.com/${esc(user.instagram)}">@${esc(user.instagram)}</a>`);
  return parts.join(' · ');
}

export function reviewKeyboard(entryId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Approve ★3', `ap:${entryId}:3`)
    .text('★4', `ap:${entryId}:4`)
    .text('★5', `ap:${entryId}:5`)
    .row()
    .text('Needs changes', `nc:${entryId}`);
}

export function draftKeyboard(entryId: number): InlineKeyboard {
  return new InlineKeyboard().text('Approve draft', `da:${entryId}`).text('Needs changes', `nc:${entryId}`);
}

/** The creator sends the link(s) to the published work. */
export function submitLinks(db: DB, user: UserRow, taskId: string, body: Record<string, unknown>): TaskView {
  const task = getTask(db, taskId);
  assertOpen(task);
  const links = cleanLinks(body.links);
  const note = text(body.note, 1000);
  const entry = ensureEntry(db, user.id, task);

  const allowed =
    task.review_mode === 'draft_first'
      ? ['draft_approved', 'in_review', 'needs_changes']
      : ['joined', 'in_review', 'needs_changes'];
  if (!allowed.includes(entry.status)) {
    throw new HubError(
      'wrong_step',
      entry.status === 'approved' ? 'This task is already approved.' : 'Send your draft first. Post after it is approved.',
    );
  }

  db.prepare(`UPDATE entries SET status = 'in_review', links = ?, note = ?, submitted_at = ? WHERE id = ?`).run(
    JSON.stringify(links),
    note,
    now(),
    entry.id,
  );

  const resent = entry.status !== 'joined' && entry.status !== 'draft_approved';
  void notifyAdmins(
    [
      `<b>${resent ? 'Resubmitted' : 'New submission'} #${entry.id}</b>`,
      `Task: ${esc(task.title)} (+${task.reward})`,
      `Creator: ${creatorLine(user)}`,
      ...links.map((link) => esc(link)),
      note ? `Note: ${esc(note)}` : '',
    ]
      .filter(Boolean)
      .join('\n') + '\n\nApprove with a score for the work, or ask for changes.',
    reviewKeyboard(entry.id),
  );
  return oneTask(db, user.id, taskId);
}

function assertDraftStep(task: TaskRow, entry: EntryRow): void {
  if (task.review_mode !== 'draft_first') throw new HubError('no_draft', 'This task does not need a draft.');
  if (!['joined', 'draft_review', 'draft_changes'].includes(entry.status)) {
    throw new HubError('wrong_step', 'Your draft is already approved.');
  }
}

/** Draft sent as a link (a cloud folder, an unlisted video). */
export function submitDraftLink(db: DB, user: UserRow, taskId: string, body: Record<string, unknown>): TaskView {
  const task = getTask(db, taskId);
  assertOpen(task);
  const [link] = cleanLinks(body.links);
  const note = text(body.note, 1000);
  const entry = ensureEntry(db, user.id, task);
  assertDraftStep(task, entry);

  db.prepare(
    `UPDATE entries SET status = 'draft_review', draft_link = ?, draft_file_id = NULL, note = ?, draft_sent_at = ? WHERE id = ?`,
  ).run(link, note, now(), entry.id);

  void notifyAdmins(
    [
      `<b>Draft #${entry.id}</b>`,
      `Task: ${esc(task.title)} (+${task.reward})`,
      `Creator: ${creatorLine(user)}`,
      esc(link),
      note ? `Note: ${esc(note)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    draftKeyboard(entry.id),
  );
  return oneTask(db, user.id, taskId);
}

/** The creator wants to upload a file: the bot asks for it in the chat. */
export function requestDraftUpload(db: DB, user: UserRow, taskId: string): void {
  const task = getTask(db, taskId);
  assertOpen(task);
  const entry = ensureEntry(db, user.id, task);
  assertDraftStep(task, entry);
  db.prepare('UPDATE users SET pending = ? WHERE id = ?').run(JSON.stringify({ type: 'draft', taskId }), user.id);
  void notifyUser(
    user.id,
    `Send your draft for <b>${esc(task.title)}</b> right here: a video or a file. I will pass it to the team.`,
  );
}

/** A file arrived in the bot chat while we were waiting for a draft. */
export function receiveDraftFile(db: DB, user: UserRow, fileId: string): { task: TaskRow; entryId: number } | null {
  let pending: { type?: string; taskId?: string } = {};
  try {
    pending = JSON.parse(user.pending ?? '{}');
  } catch {
    /* ignore a corrupt marker */
  }
  if (pending.type !== 'draft' || !pending.taskId) return null;

  const task = getTask(db, pending.taskId);
  const entry = ensureEntry(db, user.id, task);
  db.prepare('UPDATE users SET pending = NULL WHERE id = ?').run(user.id);
  if (isClosed(task) || !['joined', 'draft_review', 'draft_changes'].includes(entry.status)) return null;

  db.prepare(
    `UPDATE entries SET status = 'draft_review', draft_file_id = ?, draft_link = NULL, draft_sent_at = ? WHERE id = ?`,
  ).run(fileId, now(), entry.id);
  void notifyAdmins(
    [`<b>Draft #${entry.id}</b> (file above)`, `Task: ${esc(task.title)} (+${task.reward})`, `Creator: ${creatorLine(user)}`].join(
      '\n',
    ),
    draftKeyboard(entry.id),
  );
  return { task, entryId: entry.id };
}

// --- Review (the team's side) ------------------------------------------

export function approveDraft(db: DB, entryId: number): string {
  const entry = getEntryById(db, entryId);
  if (entry.status !== 'draft_review') throw new HubError('wrong_step', 'This draft is not waiting for review.');
  const task = getTask(db, entry.task_id);
  db.prepare(`UPDATE entries SET status = 'draft_approved', draft_approved_at = ?, comment = NULL, comment_at = NULL WHERE id = ?`).run(
    now(),
    entryId,
  );
  void notifyUser(
    entry.user_id,
    `<b>Approved.</b> Your draft for ${esc(task.title)} is good to go. Post it, then send us the link.`,
    { text: 'Send the link', path: `/tasks/${task.id}` },
  );
  return task.title;
}

export function approveEntry(db: DB, entryId: number, score: number): { title: string; reward: number } {
  const entry = getEntryById(db, entryId);
  if (entry.status !== 'in_review') throw new HubError('wrong_step', 'This submission is not waiting for review.');
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new HubError('bad_score', 'Score must be 1 to 5.');
  const task = getTask(db, entry.task_id);

  const before = ratingOf(db, entry.user_id);
  db.transaction(() => {
    db.prepare(
      `UPDATE entries SET status = 'approved', score = ?, approved_at = ?, reward = ?, comment = NULL, comment_at = NULL WHERE id = ?`,
    ).run(score, now(), task.reward, entryId);
    db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, 'task', ?, ?)`).run(
      entry.user_id,
      task.reward,
      task.title,
      String(entryId),
      now(),
    );
    db.prepare('UPDATE entries SET rating_delta = ? WHERE id = ?').run(ratingOf(db, entry.user_id) - before, entryId);
  })();

  void notifyUser(entry.user_id, `<b>Approved.</b> +${task.reward} coins are in your wallet.`, {
    text: 'Open my wallet',
    path: `/tasks/${task.id}`,
  });
  syncLevel(db, entry.user_id);
  return { title: task.title, reward: task.reward };
}

export function requestChanges(db: DB, entryId: number, comment: string): string {
  const entry = getEntryById(db, entryId);
  const next = entry.status === 'in_review' ? 'needs_changes' : entry.status === 'draft_review' ? 'draft_changes' : null;
  if (!next) throw new HubError('wrong_step', 'This submission is not waiting for review.');
  const task = getTask(db, entry.task_id);
  db.prepare('UPDATE entries SET status = ?, comment = ?, comment_at = ? WHERE id = ?').run(
    next,
    comment.trim().slice(0, 2000),
    now(),
    entryId,
  );
  void notifyUser(entry.user_id, `<b>Needs changes.</b> The team left a comment on ${esc(task.title)}.`, {
    text: 'See the comment',
    path: `/tasks/${task.id}`,
  });
  return task.title;
}

export function setViews(db: DB, entryId: number, views: number): { title: string; userId: number } {
  const entry = getEntryById(db, entryId);
  if (entry.status !== 'approved') throw new HubError('wrong_step', 'Views can be set once a submission is approved.');
  db.prepare('UPDATE entries SET views = ? WHERE id = ?').run(Math.max(0, Math.round(views)), entryId);
  syncLevel(db, entry.user_id);
  return { title: getTask(db, entry.task_id).title, userId: entry.user_id };
}

export function grantCoins(db: DB, userId: number, amount: number, title: string): void {
  db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, created_at) VALUES (?, ?, ?, 'bonus', ?)`).run(
    userId,
    amount,
    title.slice(0, 120),
    now(),
  );
}

/** Tells every creator about a task. Returns how many people were messaged. */
export function announceTask(db: DB, taskId: string): number {
  const task = getTask(db, taskId);
  const users = db.prepare('SELECT id FROM users').all() as Array<{ id: number }>;
  const where = [task.date ? `on ${shortDate(task.date)}` : '', task.place ? `at ${task.place}` : ''].filter(Boolean).join(' ');
  const lead = where ? `${task.title} ${where}.` : `${task.title}.`;
  for (const user of users) {
    void notifyUser(user.id, `<b>New task.</b> ${esc(lead)} +${task.reward} coins.`, {
      text: 'Open the task',
      path: `/tasks/${task.id}`,
    });
  }
  return users.length;
}

// --- Wallet and shop ----------------------------------------------------

export function wallet(db: DB, userId: number): WalletView {
  const history = db
    .prepare('SELECT id, title, kind, amount, created_at AS createdAt FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(userId) as WalletView['history'];
  return { balance: balanceOf(db, userId), history };
}

export function shop(db: DB, userId: number): ShopView {
  const items = db.prepare('SELECT * FROM shop_items WHERE active = 1 ORDER BY sort ASC').all() as ShopItemRow[];
  return {
    balance: balanceOf(db, userId),
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      category: item.category,
      imageUrl: item.image_url,
      needsSize: Boolean(item.needs_size),
    })),
  };
}

export function placeOrder(db: DB, user: UserRow, itemId: string, body: Record<string, unknown>): number {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(itemId) as ShopItemRow | undefined;
  if (!item) throw new HubError('item_not_found', 'This item is no longer in the shop.', 404);

  const size = text(body.size, 8);
  const address = text(body.address, 300);
  const phone = text(body.phone, 30);
  if (item.needs_size && !size) throw new HubError('size_required', 'Choose a size.');
  if (!address) throw new HubError('address_required', 'Add a delivery address.');
  if (!phone || phone.replace(/\D/g, '').length < 7) throw new HubError('phone_required', 'Add a phone number for the courier.');

  const orderId = db.transaction(() => {
    if (balanceOf(db, user.id) < item.price) throw new HubError('not_enough_coins', 'You do not have enough coins yet.');
    const order = db
      .prepare(`INSERT INTO orders (user_id, item_id, title, price, size, address, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, item.id, item.title, item.price, item.needs_size ? size : null, address, phone, now());
    db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, 'order', ?, ?)`).run(
      user.id,
      -item.price,
      item.title,
      String(order.lastInsertRowid),
      now(),
    );
    db.prepare('UPDATE users SET size = COALESCE(?, size), address = ?, phone = ? WHERE id = ?').run(
      item.needs_size ? size : null,
      address,
      phone,
      user.id,
    );
    return Number(order.lastInsertRowid);
  })();

  void notifyAdmins(
    [
      `<b>Order #${orderId}</b>: ${esc(item.title)}${item.needs_size ? `, size ${esc(size)}` : ''} (${item.price} coins)`,
      `Creator: ${creatorLine(user)}`,
      `Address: ${esc(address)}`,
      `Phone: ${esc(phone)}`,
    ].join('\n'),
  );
  return balanceOf(db, user.id);
}

export function requestCashout(db: DB, user: UserRow, body: Record<string, unknown>): number {
  const { rateKzt, minCoins } = settings.cashout;
  if (levelRank(levelOf(user, ratingOf(db, user.id))) < levelRank('pro')) {
    throw new HubError('level_locked', 'Cash-out opens at Pro level.', 403);
  }
  if (!rateKzt || !minCoins) throw new HubError('cashout_not_ready', 'Cash-out is not set up yet. Write to the team.');
  const coins = Math.floor(Number(body.coins));
  const details = text(body.details, 300);
  if (!Number.isFinite(coins) || coins < minCoins) throw new HubError('below_minimum', `The minimum is ${minCoins} coins.`);
  if (!details) throw new HubError('details_required', 'Tell us where to send the money.');

  db.transaction(() => {
    if (balanceOf(db, user.id) < coins) throw new HubError('not_enough_coins', 'You do not have that many coins.');
    const request = db
      .prepare('INSERT INTO cashouts (user_id, coins, details, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, coins, details, now());
    db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, 'Cash-out', 'cashout', ?, ?)`).run(
      user.id,
      -coins,
      String(request.lastInsertRowid),
      now(),
    );
  })();

  void notifyAdmins(
    [
      `<b>Cash-out request</b>: ${coins} coins = ${coins * rateKzt} ${settings.currencySign}`,
      `Creator: ${creatorLine(user)}`,
      `Pay to: ${esc(details)}`,
    ].join('\n'),
  );
  return balanceOf(db, user.id);
}

// --- Events -------------------------------------------------------------

interface EventJoined extends EventRow {
  code: string | null;
  checked_in_at: string | null;
  reminded: number;
  task_reward: number | null;
}

function eventView(row: EventJoined): EventView {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time,
    monthHint: row.month_hint,
    place: row.place,
    description: row.description,
    taskId: row.task_id,
    taskReward: row.task_reward,
    going: Boolean(row.code),
    code: row.code,
    checkedIn: Boolean(row.checked_in_at),
    reminded: Boolean(row.reminded),
  };
}

export function listEvents(db: DB, userId: number): EventsView {
  const rows = db
    .prepare(
      `SELECT e.*, r.code, r.checked_in_at, t.reward AS task_reward,
              EXISTS (SELECT 1 FROM reminders m WHERE m.user_id = @userId AND m.event_id = e.id) AS reminded
       FROM events e
       LEFT JOIN rsvps r ON r.event_id = e.id AND r.user_id = @userId
       LEFT JOIN tasks t ON t.id = e.task_id AND t.active = 1
       WHERE e.active = 1
       ORDER BY e.date IS NULL, e.date ASC, e.sort ASC`,
    )
    .all({ userId }) as EventJoined[];
  const today = localDate();
  const views = rows.map(eventView);
  return {
    upcoming: views.filter((event) => !event.date || event.date >= today),
    past: views.filter((event) => event.date && event.date < today).reverse(),
  };
}

function getEvent(db: DB, eventId: string): EventRow {
  const event = db.prepare('SELECT * FROM events WHERE id = ? AND active = 1').get(eventId) as EventRow | undefined;
  if (!event) throw new HubError('event_not_found', 'This event does not exist.', 404);
  return event;
}

export function rsvp(db: DB, user: UserRow, eventId: string): void {
  const event = getEvent(db, eventId);
  if (!event.date) throw new HubError('event_not_announced', 'Details for this event are not out yet.');
  if (event.date < localDate()) throw new HubError('event_past', 'This event has already happened.');
  const code = randomBytes(8).toString('base64url');
  const result = db
    .prepare('INSERT OR IGNORE INTO rsvps (user_id, event_id, code, created_at) VALUES (?, ?, ?, ?)')
    .run(user.id, eventId, code, now());
  if (result.changes) void notifyAdmins(`${creatorLine(user)} is coming to <b>${esc(event.title)}</b>.`);
}

export function cancelRsvp(db: DB, user: UserRow, eventId: string): void {
  const event = getEvent(db, eventId);
  const result = db.prepare('DELETE FROM rsvps WHERE user_id = ? AND event_id = ? AND checked_in_at IS NULL').run(user.id, eventId);
  if (result.changes) void notifyAdmins(`${creatorLine(user)} can no longer come to <b>${esc(event.title)}</b>.`);
}

export function remindMe(db: DB, userId: number, eventId: string): void {
  getEvent(db, eventId);
  db.prepare('INSERT OR IGNORE INTO reminders (user_id, event_id, created_at) VALUES (?, ?, ?)').run(userId, eventId, now());
}

/** The team scans a pass at the door. */
export function checkIn(db: DB, code: string): { name: string; event: string; already: boolean } | null {
  const row = db
    .prepare(
      `SELECT r.user_id, r.event_id, r.checked_in_at, u.first_name, e.title
       FROM rsvps r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id WHERE r.code = ?`,
    )
    .get(code) as { user_id: number; event_id: string; checked_in_at: string | null; first_name: string; title: string } | undefined;
  if (!row) return null;
  if (row.checked_in_at) return { name: row.first_name, event: row.title, already: true };

  db.transaction(() => {
    db.prepare('UPDATE rsvps SET checked_in_at = ? WHERE code = ?').run(now(), code);
    if (settings.checkinCoins > 0) {
      db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, 'event', ?, ?)`).run(
        row.user_id,
        settings.checkinCoins,
        row.title,
        row.event_id,
        now(),
      );
    }
  })();
  return { name: row.first_name, event: row.title, already: false };
}

/** Runs on a timer: day-before reminders, and "details are out" for Remind me. */
export function sendEventReminders(db: DB): void {
  const tomorrow = localDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const going = db
    .prepare(
      `SELECT r.user_id, e.id, e.title FROM rsvps r JOIN events e ON e.id = r.event_id
       WHERE e.active = 1 AND e.date = ? AND r.reminded_at IS NULL`,
    )
    .all(tomorrow) as Array<{ user_id: number; id: string; title: string }>;
  for (const row of going) {
    db.prepare('UPDATE rsvps SET reminded_at = ? WHERE user_id = ? AND event_id = ?').run(now(), row.user_id, row.id);
    void notifyUser(row.user_id, `<b>Tomorrow:</b> ${esc(row.title)}. Your pass is ready.`, {
      text: 'Show my pass',
      path: `/events/${row.id}/pass`,
    });
  }

  const announced = db
    .prepare(
      `SELECT m.user_id, e.id, e.title, e.date, e.place FROM reminders m JOIN events e ON e.id = m.event_id
       WHERE e.active = 1 AND e.date IS NOT NULL AND e.date >= ? AND m.notified_at IS NULL`,
    )
    .all(localDate()) as Array<{ user_id: number; id: string; title: string; date: string; place: string | null }>;
  for (const row of announced) {
    db.prepare('UPDATE reminders SET notified_at = ? WHERE user_id = ? AND event_id = ?').run(now(), row.user_id, row.id);
    const where = row.place ? `, ${row.place}` : '';
    void notifyUser(row.user_id, `<b>${esc(row.title)}</b> is on ${shortDate(row.date)}${esc(where)}. Tell us if you are coming.`, {
      text: 'Open events',
      path: '/events',
    });
  }
}

// --- Offers, home -------------------------------------------------------

const offerView = (row: OfferRow): OfferView => ({
  id: row.id,
  campaign: row.campaign,
  fee: row.fee,
  need: row.need,
  postBy: row.post_by,
  answerBy: row.answer_by,
  status: row.status,
});

export function currentOffer(db: DB, userId: number): OfferView | null {
  const row = db.prepare(`SELECT * FROM offers WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`).get(userId) as
    | OfferRow
    | undefined;
  return row ? offerView(row) : null;
}

export function createOffer(db: DB, userId: number, fields: [string, string, string, string, string]): void {
  db.prepare(
    'INSERT INTO offers (user_id, campaign, fee, need, post_by, answer_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(userId, ...fields, now());
  void notifyUser(userId, `<b>A paid offer, only for you.</b> ${esc(fields[0])}.`, { text: 'See the offer', path: '/offer' });
}

export function answerOffer(db: DB, user: UserRow, offerId: number, accept: boolean): void {
  const offer = db.prepare(`SELECT * FROM offers WHERE id = ? AND user_id = ? AND status = 'open'`).get(offerId, user.id) as
    | OfferRow
    | undefined;
  if (!offer) throw new HubError('offer_not_found', 'This offer is no longer open.', 404);
  db.prepare('UPDATE offers SET status = ?, answered_at = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', now(), offerId);
  void notifyAdmins(
    `${creatorLine(user)} <b>${accept ? 'accepted' : 'declined'}</b> the offer “${esc(offer.campaign)}”.` +
      (accept ? ' Write to them directly to agree the idea and the details.' : ''),
  );
  if (accept) {
    void notifyUser(user.id, `<b>Offer accepted.</b> Your manager will write to you directly about ${esc(offer.campaign)}.`);
  }
}

export function home(db: DB, userId: number): HomeView {
  const tasks = listTasks(db, userId).filter((task) => !task.closed);
  const needsAction = ['joined', 'draft_approved', 'needs_changes', 'draft_changes'];
  const fresh = tasks.filter((task) => !task.entry);
  const nextTask = tasks.find((task) => task.entry && needsAction.includes(task.entry.status)) ?? fresh[0] ?? null;

  const news = db.prepare('SELECT id, title, summary, date, url FROM news WHERE active = 1 ORDER BY sort ASC LIMIT 1').get() as
    | NewsView
    | undefined;
  const events = listEvents(db, userId).upcoming;
  return {
    nextTask,
    newCount: fresh.length,
    nextEvent: events.find((event) => event.date) ?? events[0] ?? null,
    news: news ?? null,
    offer: currentOffer(db, userId),
  };
}
