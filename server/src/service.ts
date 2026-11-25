import { randomBytes } from 'node:crypto';
import { audienceSubject, isSetUp } from './account.js';
import { matchesAudience, parseAudience, type AudienceSubject } from './audience.js';
import { config, isAdmin, settings } from './config.js';
import {
  now,
  type DB,
  type EntryRow,
  type EventRow,
  type OfferRow,
  type PublicationRow,
  type ShopItemRow,
  type TaskRow,
  type UserRow,
} from './db.js';
import { HubError } from './errors.js';
import { liveStories } from './hubstories.js';
import { creatorLine, draftKeyboard, esc, notifyAdmins, notifyUser } from './notify.js';
import { latestSubmission, publicationsOf, publicationView, setStoryViews, startSubmission, submissionView } from './pipeline.js';
import { cleanHandle } from './social/links.js';
import type {
  EntryView,
  EventsView,
  EventView,
  HomeView,
  LeaderboardView,
  Level,
  Me,
  OfferView,
  PublicSettings,
  ShopView,
  StoryView,
  TaskView,
  WalletView,
} from './types.js';

export { HubError } from './errors.js';
export { creatorLine, draftKeyboard, reviewKeyboard } from './notify.js';

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
export function syncLevel(db: DB, userId: number): void {
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
    onboarded: isSetUp(db, user),
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
    avatarUrl: user.avatar_url,
    accountStatus: user.account_status,
    accountNote: user.account_status === 'rejected' ? user.account_note : null,
    hasBirthDate: Boolean(user.birth_date),
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
    minAge: settings.minAge,
    accountConfirmTime: settings.accountConfirmTime,
  };
}

const text = (value: unknown, max: number): string | null => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : null;
};

/**
 * "My details". The Instagram handle is not changed here: a new handle goes through the
 * connect flow (account.ts) so that the team can confirm it. TikTok is optional and free.
 */
export function updateDetails(db: DB, user: UserRow, body: Record<string, unknown>): void {
  let tiktok = user.tiktok;
  if ('tiktok' in body) {
    const typed = String(body.tiktok ?? '').trim();
    tiktok = typed ? cleanHandle(typed) : null;
    if (typed && !tiktok) throw new HubError('bad_handle', 'That TikTok handle does not look right: letters, numbers, dots and underscores.');
  }
  const next = {
    tiktok,
    city: 'city' in body ? text(body.city, 80) ?? user.city : user.city,
    size: 'size' in body ? text(body.size, 8) : user.size,
    address: 'address' in body ? text(body.address, 300) : user.address,
    phone: 'phone' in body ? text(body.phone, 30) : user.phone,
  };
  db.prepare('UPDATE users SET tiktok = ?, city = ?, size = ?, address = ?, phone = ? WHERE id = ?').run(
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

const isClosed = (task: TaskRow): boolean =>
  !task.active || task.status !== 'active' || new Date(task.deadline).getTime() < Date.now();

/** Announced, but its start has not come: listed under Soon, not open for joining yet. */
const isSoon = (task: TaskRow): boolean => Boolean(task.starts_at) && new Date(task.starts_at!).getTime() > Date.now();

const LOCKED_REASON = 'We could not confirm your Instagram account, so tasks are locked. Connect the account that is yours in your profile.';

/** Everything about the creator that decides what they see, read once per request. */
interface Viewer {
  user: UserRow;
  subject: AudienceSubject;
}

function viewerOf(db: DB, user: UserRow): Viewer {
  return { user, subject: audienceSubject(db, user, levelOf(user, ratingOf(db, user.id))) };
}

const participants = (db: DB, taskId: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM entries WHERE task_id = ?').get(taskId) as { n: number }).n;

/**
 * A task is visible to a creator who already took part in it, or when it is published, open,
 * and the creator is in its audience. The same rule serves the list, opening by link and joining.
 */
function canSee(task: TaskRow, viewer: Viewer, entry: EntryRow | undefined): boolean {
  if (entry) return true;
  return !isClosed(task) && matchesAudience(viewer.subject, parseAudience(task.audience));
}

function taskView(db: DB, task: TaskRow, entry: EntryRow | undefined, viewer: Viewer): TaskView {
  const approved = entry?.status === 'approved';
  const latest = entry ? latestSubmission(db, entry.id) : undefined;
  // Not open yet, and this creator is not in it: the brief and the steps wait for the start.
  const waiting = !entry && isSoon(task);
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
    steps: waiting ? [] : (JSON.parse(task.steps) as string[]),
    entry: entry ? entryView(entry) : null,
    brief: waiting ? null : task.brief,
    formats: JSON.parse(task.formats || '[]') as TaskView['formats'],
    requiredMention: task.required_mention,
    requiredHashtag: task.required_hashtag,
    startsAt: task.starts_at,
    opensAt: waiting ? task.starts_at : null,
    reminded: waiting && Boolean(db.prepare('SELECT 1 FROM task_reminders WHERE user_id = ? AND task_id = ?').get(viewer.user.id, task.id)),
    openedAt: task.starts_at ?? task.created_at,
    bonusCoins: task.bonus_coins,
    maxPublications: Math.max(1, task.max_publications),
    full: task.max_participants !== null && participants(db, task.id) >= task.max_participants,
    locked: viewer.user.account_status === 'rejected' ? LOCKED_REASON : null,
    publications: entry ? publicationsOf(db, entry.id).map((row) => publicationView(row, approved)) : [],
    // A finished check is history: only a running one or a refusal is news for the app.
    submission: latest && latest.status !== 'done' ? submissionView(latest) : null,
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

/** A task this creator may look at. Hidden ones answer exactly like missing ones. */
function visibleTask(db: DB, viewer: Viewer, taskId: string): { task: TaskRow; entry: EntryRow | undefined } {
  const task = getTask(db, taskId);
  const entry = getEntry(db, viewer.user.id, taskId);
  if (!canSee(task, viewer, entry)) throw new HubError('task_not_found', 'This task does not exist.', 404);
  return { task, entry };
}

/** Every task the creator can see: open ones for their audience, plus any they already took part in. */
export function listTasks(db: DB, userId: number): TaskView[] {
  const user = getUser(db, userId);
  if (!user) return [];
  const viewer = viewerOf(db, user);
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY active DESC, sort ASC, deadline ASC').all() as TaskRow[];
  const entries = db.prepare('SELECT * FROM entries WHERE user_id = ?').all(userId) as EntryRow[];
  const byTask = new Map(entries.map((entry) => [entry.task_id, entry]));
  return tasks.filter((task) => canSee(task, viewer, byTask.get(task.id))).map((task) => taskView(db, task, byTask.get(task.id), viewer));
}

export function oneTask(db: DB, userId: number, taskId: string): TaskView {
  const user = getUser(db, userId);
  if (!user) throw new HubError('task_not_found', 'This task does not exist.', 404);
  const viewer = viewerOf(db, user);
  const { task, entry } = visibleTask(db, viewer, taskId);
  return taskView(db, task, entry, viewer);
}

function assertOpen(task: TaskRow): void {
  if (isClosed(task)) throw new HubError('task_closed', 'The deadline for this task has passed.');
}

function assertNotLocked(user: UserRow): void {
  if (user.account_status === 'rejected') throw new HubError('account_rejected', LOCKED_REASON, 403);
}

/**
 * The creator's entry for a task, creating it when they join. Joining checks everything a
 * newcomer must pass: the task is open and visible to them, and there is still room.
 */
function ensureEntry(db: DB, user: UserRow, taskId: string): { task: TaskRow; entry: EntryRow; created: boolean } {
  return db.transaction(() => {
    const viewer = viewerOf(db, user);
    const { task, entry } = visibleTask(db, viewer, taskId);
    if (entry) return { task, entry, created: false };
    assertNotLocked(user);
    assertOpen(task);
    if (isSoon(task)) throw new HubError('task_not_open', 'This task is not open yet. The bot can tell you when it opens.', 409);
    if (task.max_participants !== null && participants(db, task.id) >= task.max_participants) {
      throw new HubError('task_full', 'All places on this task are taken.', 409);
    }
    db.prepare(`INSERT INTO entries (user_id, task_id, status, joined_at) VALUES (?, ?, 'joined', ?)`).run(user.id, task.id, now());
    return { task, entry: getEntry(db, user.id, task.id)!, created: true };
  })();
}

export function joinTask(db: DB, user: UserRow, taskId: string): TaskView {
  const { task, created } = ensureEntry(db, user, taskId);
  if (created) void notifyAdmins(db, `${creatorLine(user)} is in for <b>${esc(task.title)}</b>.`);
  return oneTask(db, user.id, taskId);
}

function cleanLinks(input: unknown, max: number): string[] {
  const raw = Array.isArray(input) ? input.slice(0, 20) : [input];
  const links: string[] = [];
  for (const item of raw) {
    let value = String(item ?? '').trim();
    if (!value) continue;
    if (value.length > 500) throw new HubError('bad_link', 'That link is too long. Copy it from the app and paste it here.');
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (!url.hostname.includes('.') || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new Error('no host');
      const clean = url.toString();
      if (!links.includes(clean)) links.push(clean);
    } catch {
      throw new HubError('bad_link', 'That does not look like a link. Copy it from the app and paste it here.');
    }
  }
  if (!links.length) throw new HubError('link_required', 'Paste the link to your post.');
  if (links.length > max) {
    throw new HubError('too_many_links', max === 1 ? 'This task takes one link.' : `This task takes up to ${max} links.`);
  }
  return links;
}

/** How long the send waits for its check before answering "Checking your link". */
const CHECK_WAIT_MS = 2500;

/**
 * The creator sends the link(s) to the published work. The links are checked in the background
 * (pipeline.ts): the answer comes at once, or as soon as the check is done if that is quick.
 * The app shows "Checking your link" while `submission.status` is 'checking'.
 */
export async function submitLinks(db: DB, user: UserRow, taskId: string, body: Record<string, unknown>): Promise<TaskView> {
  // Read the links before joining anyone: a typo must not leave an entry behind.
  const links = cleanLinks(body.links, Math.max(1, getTask(db, taskId).max_publications));
  const note = text(body.note, 1000);
  const { task, entry } = ensureEntry(db, user, taskId);
  assertNotLocked(user);
  assertOpen(task);

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
  if (latestSubmission(db, entry.id)?.status === 'checking') {
    throw new HubError('still_checking', 'We are still checking your last link. Give it a moment.', 409);
  }

  const submission = startSubmission(db, entry, links, note);
  const deadline = Date.now() + CHECK_WAIT_MS;
  while (Date.now() < deadline && latestSubmission(db, entry.id)?.id === submission.id && latestSubmission(db, entry.id)?.status === 'checking') {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return oneTask(db, user.id, taskId);
}

/** The creator's story, for the "How many people saw your story?" screen. */
export function storyOf(db: DB, userId: number, publicationId: number): { publication: PublicationRow; view: StoryView } {
  const row = db
    .prepare(
      `SELECT p.*, t.title AS task_title, e.status AS entry_status FROM publications p
       JOIN tasks t ON t.id = p.task_id JOIN entries e ON e.id = p.entry_id
       WHERE p.id = ? AND p.user_id = ? AND p.kind = 'story' AND p.removed_at IS NULL`,
    )
    .get(publicationId, userId) as (PublicationRow & { task_title: string; entry_status: string }) | undefined;
  if (!row) throw new HubError('story_not_found', 'This story is not one of yours.', 404);
  const view: StoryView = {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    postedAt: row.published_at ?? row.created_at,
    hasCopy: Boolean(row.media_path),
    copyIsImage: Boolean(row.media_path && /\.(jpg|png|webp)$/.test(row.media_path)),
    views: row.story_views,
    answeredAt: row.story_answered_at,
    hasScreenshot: Boolean(row.story_screenshot_path),
    editable: !row.story_answered_at || row.entry_status !== 'approved',
  };
  return { publication: row, view };
}

/** A number of views as typed: "1 240" and "1,240" are fine, anything else is refused. */
export function parseViews(value: unknown): number {
  const number = typeof value === 'string' ? Number(value.replace(/[\s,]/g, '')) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(number) || number < 0 || number > 100_000_000) {
    throw new HubError('bad_views', 'Enter the number of views as a whole number.');
  }
  return number;
}

/** The creator sends the number of views of their story, with an optional screenshot (already saved, private). */
export function sendStoryViews(db: DB, user: UserRow, publicationId: number, views: unknown, screenshotPath: string | null): StoryView {
  const { view } = storyOf(db, user.id, publicationId);
  if (!view.editable) throw new HubError('story_closed', 'This work is approved: the number can no longer change. Write to the team if it is wrong.');
  const number = parseViews(views);
  setStoryViews(db, publicationId, number, { kind: 'creator' }, screenshotPath);
  void notifyAdmins(
    db,
    `${creatorLine(user)} says their story for <b>${esc(view.taskTitle)}</b> has <b>${number.toLocaleString('en-US')}</b> views${
      screenshotPath ? ', with a screenshot of the statistics' : ', without a screenshot'
    }.`,
  );
  return storyOf(db, user.id, publicationId).view;
}

function assertDraftStep(task: TaskRow, entry: EntryRow): void {
  if (task.review_mode !== 'draft_first') throw new HubError('no_draft', 'This task does not need a draft.');
  if (!['joined', 'draft_review', 'draft_changes'].includes(entry.status)) {
    throw new HubError('wrong_step', 'Your draft is already approved.');
  }
}

/** Draft sent as a link (a cloud folder, an unlisted video). */
export function submitDraftLink(db: DB, user: UserRow, taskId: string, body: Record<string, unknown>): TaskView {
  const [link] = cleanLinks(body.links, 1);
  const note = text(body.note, 1000);
  const { task, entry } = ensureEntry(db, user, taskId);
  assertNotLocked(user);
  assertOpen(task);
  assertDraftStep(task, entry);

  db.prepare(
    `UPDATE entries SET status = 'draft_review', draft_link = ?, draft_file_id = NULL, note = ?, draft_sent_at = ? WHERE id = ?`,
  ).run(link, note, now(), entry.id);

  void notifyAdmins(
    db,
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
  const { task, entry } = ensureEntry(db, user, taskId);
  assertNotLocked(user);
  assertOpen(task);
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

  db.prepare('UPDATE users SET pending = NULL WHERE id = ?').run(user.id);
  const task = getTask(db, pending.taskId);
  const entry = getEntry(db, user.id, task.id);
  if (!entry || isClosed(task) || user.account_status === 'rejected' || !['joined', 'draft_review', 'draft_changes'].includes(entry.status)) return null;

  db.prepare(
    `UPDATE entries SET status = 'draft_review', draft_file_id = ?, draft_link = NULL, draft_sent_at = ? WHERE id = ?`,
  ).run(fileId, now(), entry.id);
  void notifyAdmins(
    db,
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
  const creator = getUser(db, entry.user_id);
  if (creator?.account_status !== 'confirmed') {
    throw new HubError(
      'account_not_confirmed',
      creator?.account_status === 'rejected'
        ? 'This creator\'s Instagram account was rejected. No coins until they connect an account the team confirms.'
        : 'This creator\'s Instagram account is not confirmed yet. Confirm the account first, then approve the work.',
      409,
    );
  }

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

/** Tells the creators in the task's audience about it. Returns how many people were messaged. */
export function announceTask(db: DB, taskId: string): number {
  const task = getTask(db, taskId);
  if (isClosed(task)) throw new HubError('task_closed', 'This task is not open, so there is nothing to announce.');
  const audience = parseAudience(task.audience);
  const users = (
    db.prepare(`SELECT * FROM users WHERE onboarded_at IS NOT NULL AND account_status != 'rejected'`).all() as UserRow[]
  ).filter((user) => isSetUp(db, user) && matchesAudience(viewerOf(db, user).subject, audience));
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
    db,
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
  task_title: string | null;
  going_count: number;
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
    details: row.details,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskReward: row.task_reward,
    goingCount: row.going_count,
    going: Boolean(row.code),
    code: row.code,
    checkedIn: Boolean(row.checked_in_at),
    reminded: Boolean(row.reminded),
    coverUrl: row.cover_url,
  };
}

export function listEvents(db: DB, userId: number): EventsView {
  const rows = db
    .prepare(
      `SELECT e.*, r.code, r.checked_in_at, t.reward AS task_reward, t.title AS task_title,
              (SELECT COUNT(*) FROM rsvps g WHERE g.event_id = e.id) AS going_count,
              EXISTS (SELECT 1 FROM reminders m WHERE m.user_id = @userId AND m.event_id = e.id) AS reminded
       FROM events e
       LEFT JOIN rsvps r ON r.event_id = e.id AND r.user_id = @userId
       LEFT JOIN tasks t ON t.id = e.task_id AND t.active = 1
       WHERE e.active = 1
       ORDER BY e.date IS NULL, e.date ASC, e.sort ASC`,
    )
    .all({ userId }) as EventJoined[];
  // The linked task, its reward and its link are shown only to creators who can see that task.
  const user = getUser(db, userId);
  const viewer = user ? viewerOf(db, user) : null;
  for (const row of rows) {
    if (!row.task_id) continue;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.task_id) as TaskRow | undefined;
    if (!task || !viewer || !canSee(task, viewer, getEntry(db, userId, task.id))) {
      row.task_id = null;
      row.task_reward = null;
      row.task_title = null;
    }
  }
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
  if (result.changes) void notifyAdmins(db, `${creatorLine(user)} is coming to <b>${esc(event.title)}</b>.`);
}

export function cancelRsvp(db: DB, user: UserRow, eventId: string): void {
  const event = getEvent(db, eventId);
  const result = db.prepare('DELETE FROM rsvps WHERE user_id = ? AND event_id = ? AND checked_in_at IS NULL').run(user.id, eventId);
  if (result.changes) void notifyAdmins(db, `${creatorLine(user)} can no longer come to <b>${esc(event.title)}</b>.`);
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
  brief: row.brief,
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
    db,
    `${creatorLine(user)} <b>${accept ? 'accepted' : 'declined'}</b> the offer “${esc(offer.campaign)}”.` +
      (accept ? ' Write to them directly to agree the idea and the details.' : ''),
  );
  if (accept) {
    void notifyUser(user.id, `<b>Offer accepted.</b> Your manager will write to you directly about ${esc(offer.campaign)}.`);
  }
}

/** "Remind me": the bot tells the creator the moment a task that is not open yet opens. */
export function remindTask(db: DB, user: UserRow, taskId: string, on: boolean): TaskView {
  const { task } = visibleTask(db, viewerOf(db, user), taskId);
  if (on) {
    if (!isSoon(task) || isClosed(task)) throw new HubError('task_open', 'This task is already open.', 409);
    db.prepare('INSERT OR IGNORE INTO task_reminders (user_id, task_id, created_at) VALUES (?, ?, ?)').run(user.id, taskId, now());
  } else {
    db.prepare('DELETE FROM task_reminders WHERE user_id = ? AND task_id = ? AND notified_at IS NULL').run(user.id, taskId);
  }
  return oneTask(db, user.id, taskId);
}

/** Runs on a timer: tells everyone who asked that a task has opened. Each reminder is sent once. */
export function sendTaskReminders(db: DB): number {
  const due = db
    .prepare(
      `SELECT m.user_id, t.id, t.title, t.reward FROM task_reminders m JOIN tasks t ON t.id = m.task_id
       WHERE m.notified_at IS NULL AND t.active = 1 AND t.status = 'active' AND t.starts_at IS NOT NULL AND t.starts_at <= ? AND t.deadline > ?`,
    )
    .all(now(), now()) as Array<{ user_id: number; id: string; title: string; reward: number }>;
  for (const row of due) {
    db.prepare('UPDATE task_reminders SET notified_at = ? WHERE user_id = ? AND task_id = ?').run(now(), row.user_id, row.id);
    void notifyUser(row.user_id, `<b>Open now:</b> ${esc(row.title)}. +${row.reward} ${row.reward === 1 ? 'coin' : 'coins'}.`, {
      text: 'Open the task',
      path: `/tasks/${row.id}`,
    });
  }
  return due.length;
}

/** How many open tasks Home shows before "All tasks". */
const HOME_TASKS = 3;
/** How many events Home shows under "Coming up". */
const HOME_EVENTS = 2;

export function home(db: DB, userId: number): HomeView {
  const tasks = listTasks(db, userId).filter((task) => !task.closed);
  const fresh = tasks.filter((task) => !task.entry);
  // Open: can be joined today. A full task stays in the Tasks tab, Home has no room for a dead end.
  const open = fresh.filter((task) => !task.opensAt && !task.full);
  const fix = tasks.filter((task) => task.entry && ['needs_changes', 'draft_changes'].includes(task.entry.status));
  const events = listEvents(db, userId).upcoming.filter((event) => event.date);
  return {
    stories: liveStories(db, userId),
    openTasks: open.slice(0, HOME_TASKS),
    openCount: open.length,
    soonCount: fresh.filter((task) => task.opensAt).length,
    needsFix: { count: fix.length, taskId: fix[0]?.id ?? null },
    events: events.slice(0, HOME_EVENTS),
    offer: currentOffer(db, userId),
  };
}
