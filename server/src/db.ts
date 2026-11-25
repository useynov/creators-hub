import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { rootDir } from './config.js';
import type { EntryStatus, Level, ReviewMode } from './types.js';

export type AccountStatus = 'pending' | 'confirmed' | 'rejected';
export type TaskStatus = 'draft' | 'active' | 'closed';
export type Platform = 'instagram' | 'tiktok';
export type PublicationKind = 'reel' | 'post' | 'story' | 'tiktok' | 'unknown';
export type TeamRole = 'owner' | 'manager' | 'viewer';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE,
  username TEXT UNIQUE COLLATE NOCASE,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT COLLATE NOCASE,
  first_name TEXT NOT NULL,
  instagram TEXT,
  tiktok TEXT,
  city TEXT,
  size TEXT,
  address TEXT,
  phone TEXT,
  level TEXT NOT NULL DEFAULT 'member',
  level_override TEXT,
  onboarded_at TEXT,
  pending TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  cover_url TEXT,
  reward INTEGER NOT NULL,
  format TEXT,
  date TEXT,
  place TEXT,
  deadline TEXT NOT NULL,
  review_mode TEXT NOT NULL DEFAULT 'post_first',
  views_bonus INTEGER NOT NULL DEFAULT 0,
  steps TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  submitted_at TEXT,
  draft_link TEXT,
  draft_file_id TEXT,
  draft_sent_at TEXT,
  draft_approved_at TEXT,
  comment TEXT,
  comment_at TEXT,
  score INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  reward INTEGER,
  rating_delta INTEGER,
  UNIQUE (user_id, task_id)
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id);
CREATE TABLE IF NOT EXISTS shop_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'merch',
  image_url TEXT,
  needs_size INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,
  size TEXT,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cashouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  coins INTEGER NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT,
  time TEXT,
  month_hint TEXT,
  place TEXT,
  description TEXT,
  task_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rsvps (
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  checked_in_at TEXT,
  reminded_at TEXT,
  PRIMARY KEY (user_id, event_id)
);
CREATE TABLE IF NOT EXISTS reminders (
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL,
  notified_at TEXT,
  PRIMARY KEY (user_id, event_id)
);
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  date TEXT,
  url TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  campaign TEXT NOT NULL,
  fee TEXT NOT NULL,
  need TEXT NOT NULL,
  post_by TEXT NOT NULL,
  answer_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS support_threads (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE TABLE IF NOT EXISTS admin_pending (
  admin_id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_profiles (
  user_id INTEGER NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,
  handle TEXT NOT NULL COLLATE NOCASE,
  external_id TEXT,
  full_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  is_private INTEGER NOT NULL DEFAULT 0,
  is_verified INTEGER NOT NULL DEFAULT 0,
  avg_reel_views INTEGER,
  engagement_rate REAL,
  recent TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ok',
  source TEXT NOT NULL DEFAULT 'demo',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, platform)
);
CREATE TABLE IF NOT EXISTS user_tags (
  user_id INTEGER NOT NULL REFERENCES users(id),
  tag TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (user_id, tag)
);
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'other',
  kind TEXT NOT NULL DEFAULT 'unknown',
  external_id TEXT,
  author_handle TEXT COLLATE NOCASE,
  published_at TEXT,
  caption TEXT,
  mentions TEXT NOT NULL DEFAULT '[]',
  hashtags TEXT NOT NULL DEFAULT '[]',
  thumb_path TEXT,
  media_path TEXT,
  checks TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'tracking',
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  views_source TEXT NOT NULL DEFAULT 'none',
  story_views INTEGER,
  story_screenshot_path TEXT,
  story_asked_at TEXT,
  story_answered_at TEXT,
  created_at TEXT NOT NULL,
  final_at TEXT,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS publications_entry ON publications(entry_id);
CREATE INDEX IF NOT EXISTS publications_task ON publications(task_id);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL REFERENCES publications(id),
  kind TEXT NOT NULL,
  due_at TEXT NOT NULL,
  taken_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  error TEXT,
  UNIQUE (publication_id, kind)
);
CREATE INDEX IF NOT EXISTS snapshots_due ON snapshots(status, due_at);
CREATE TABLE IF NOT EXISTS team_members (
  telegram_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT COLLATE NOCASE,
  role TEXT NOT NULL,
  added_by INTEGER,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_logins (
  token_hash TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS age_refusals (
  telegram_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_lookups (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  platform TEXT NOT NULL DEFAULT 'instagram',
  handle TEXT NOT NULL COLLATE NOCASE,
  attempt TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  links TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'checking',
  result TEXT NOT NULL DEFAULT '[]',
  tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS submissions_entry ON submissions(entry_id, id);
CREATE TABLE IF NOT EXISTS task_reminders (
  user_id INTEGER NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  created_at TEXT NOT NULL,
  notified_at TEXT,
  PRIMARY KEY (user_id, task_id)
);
CREATE TABLE IF NOT EXISTS hub_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  kicker TEXT,
  headline TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  tone TEXT NOT NULL DEFAULT 'dark',
  button_label TEXT,
  button_path TEXT,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS hub_story_views (
  user_id INTEGER NOT NULL REFERENCES users(id),
  story_id INTEGER NOT NULL REFERENCES hub_stories(id),
  seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, story_id)
);
CREATE TABLE IF NOT EXISTS media_copies (
  remote_url TEXT PRIMARY KEY,
  url TEXT,
  status TEXT NOT NULL,
  tried_at TEXT NOT NULL
);
`;

/** A story of the Hub's own news channel, posted by the team. Not a creator's Instagram story. */
export interface HubStoryRow {
  id: number;
  /** The word under the circle on Home. */
  label: string;
  /** The small line over the headline, e.g. "Event · 26 Dec · Almaty". */
  kicker: string | null;
  headline: string;
  body: string | null;
  image_url: string | null;
  /** The background when there is no photo. */
  tone: 'dark' | 'red';
  button_label: string | null;
  /** A screen of the mini app, e.g. /events/creators-ny-party. */
  button_path: string | null;
  /** The last day it is shown (hub time zone). null: until the team hides it. */
  ends_on: string | null;
  status: 'draft' | 'live';
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
  published_at: string | null;
}

export interface UserRow {
  id: number;
  username: string | null;
  first_name: string;
  instagram: string | null;
  tiktok: string | null;
  city: string | null;
  size: string | null;
  address: string | null;
  phone: string | null;
  level: Level;
  level_override: Level | null;
  onboarded_at: string | null;
  pending: string | null;
  created_at: string;
  birth_date: string | null;
  avatar_url: string | null;
  account_status: AccountStatus;
  account_note: string | null;
  account_reviewed_by: number | null;
  account_reviewed_at: string | null;
  market: string;
}

export interface TaskRow {
  id: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  reward: number;
  format: string | null;
  date: string | null;
  place: string | null;
  deadline: string;
  review_mode: ReviewMode;
  views_bonus: number;
  steps: string;
  sort: number;
  active: number;
  brief: string | null;
  /** JSON array of PublicationKind the task accepts. Empty means any. */
  formats: string;
  required_mention: string | null;
  required_hashtag: string | null;
  starts_at: string | null;
  max_publications: number;
  max_participants: number | null;
  bonus_coins: number | null;
  status: TaskStatus;
  /** JSON, see Audience in audience.ts */
  audience: string;
  source: 'seed' | 'admin';
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  market: string;
}

export interface EntryRow {
  id: number;
  user_id: number;
  task_id: string;
  status: EntryStatus;
  joined_at: string;
  links: string;
  note: string | null;
  submitted_at: string | null;
  draft_link: string | null;
  draft_file_id: string | null;
  draft_sent_at: string | null;
  draft_approved_at: string | null;
  comment: string | null;
  comment_at: string | null;
  score: number | null;
  views: number;
  approved_at: string | null;
  reward: number | null;
  rating_delta: number | null;
}

export interface EventRow {
  id: string;
  title: string;
  date: string | null;
  time: string | null;
  month_hint: string | null;
  place: string | null;
  description: string | null;
  task_id: string | null;
  sort: number;
  active: number;
  cover_url: string | null;
  details: string | null;
}

export interface ShopItemRow {
  id: string;
  title: string;
  price: number;
  category: 'merch' | 'gift';
  image_url: string | null;
  needs_size: number;
  sort: number;
  active: number;
  description: string | null;
  /** JSON array of photo addresses, the cover first. */
  images: string | null;
  /** JSON array of sizes on offer; null for an item without sizes. */
  sizes: string | null;
  /** How many are left; null when the team does not count. */
  stock: number | null;
  /** How many one creator may order; null for no limit. */
  per_creator: number | null;
  /** JSON array of things to choose from that are not sizes (drinks, colours); null for none. */
  choices: string | null;
  /** The word for that choice: "Drink", "Colour". */
  choice_label: string | null;
  /** How many one creator may order in a calendar month; null for no monthly limit. */
  per_month: number | null;
  delivery: 'courier' | 'message';
  /** 'seed' until someone edits the item on the admin site; then the file never touches it again. */
  source: 'seed' | 'admin';
  updated_at: string | null;
}

export interface OfferRow {
  id: number;
  user_id: number;
  campaign: string;
  fee: string;
  need: string;
  post_by: string;
  answer_by: string;
  status: 'open' | 'accepted' | 'declined';
  created_at: string;
  answered_at: string | null;
  brief: string | null;
}

export interface SocialProfileRow {
  user_id: number;
  platform: Platform;
  handle: string;
  external_id: string | null;
  full_name: string | null;
  bio: string | null;
  /** Path under /media when we keep our own copy, otherwise null. */
  avatar_url: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  is_private: number;
  is_verified: number;
  avg_reel_views: number | null;
  /** Percent, e.g. 6.1 */
  engagement_rate: number | null;
  /** JSON array of RecentPost (social/types.ts) */
  recent: string;
  status: 'ok' | 'private' | 'not_found' | 'error';
  source: 'apify' | 'demo';
  fetched_at: string;
}

export interface PublicationRow {
  id: number;
  entry_id: number;
  user_id: number;
  task_id: string;
  url: string;
  platform: Platform | 'other';
  kind: PublicationKind;
  external_id: string | null;
  author_handle: string | null;
  published_at: string | null;
  caption: string | null;
  mentions: string;
  hashtags: string;
  thumb_path: string | null;
  /** Our saved copy of a story, private to the team. */
  media_path: string | null;
  /** JSON, see LinkChecks in social/types.ts */
  checks: string;
  status: 'tracking' | 'final' | 'removed' | 'unreachable';
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views_source: 'auto' | 'creator' | 'none';
  story_views: number | null;
  story_screenshot_path: string | null;
  story_asked_at: string | null;
  story_answered_at: string | null;
  created_at: string;
  final_at: string | null;
  removed_at: string | null;
  data_source: 'apify' | 'demo' | null;
  story_reminded_at: string | null;
  missed_at: string | null;
}

export type SnapshotKind = 'submit' | 'h24' | 'd7' | 'd14';

export interface SnapshotRow {
  id: number;
  publication_id: number;
  kind: SnapshotKind;
  due_at: string;
  taken_at: string | null;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  error: string | null;
  attempts: number;
}

export interface TeamMemberRow {
  telegram_id: number;
  name: string;
  username: string | null;
  role: TeamRole;
  added_by: number | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface OrderRow {
  id: number;
  user_id: number;
  item_id: string;
  title: string;
  price: number;
  size: string | null;
  address: string;
  phone: string;
  status: 'new' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  created_at: string;
  status_at: string | null;
  status_by: number | null;
  delivery: 'courier' | 'message';
  cancelled_by: 'creator' | 'team' | null;
  cancel_note: string | null;
}

export interface CashoutRow {
  id: number;
  user_id: number;
  coins: number;
  details: string;
  status: 'new' | 'paid' | 'rejected';
  created_at: string;
  decided_at: string | null;
  decided_by: number | null;
  note: string | null;
}

/**
 * Sample creators (see sample.ts) live in a block of ids far above any real Telegram id.
 * The bot never messages them and the data jobs never read anything about them.
 */
export const SAMPLE_ID_FROM = 9_900_000_000_001;
export const SAMPLE_ID_TO = 9_900_000_000_999;
export const isSampleId = (id: number): boolean => id >= SAMPLE_ID_FROM && id <= SAMPLE_ID_TO;
/** For SQL: `${SAMPLE_IDS_SQL('u.id')}` is true for a sample creator's id. */
export const SAMPLE_IDS_SQL = (column: string): string => `${column} BETWEEN ${SAMPLE_ID_FROM} AND ${SAMPLE_ID_TO}`;

/**
 * Columns added after the first release. CREATE TABLE IF NOT EXISTS does not touch
 * a table that is already there, so each new column is added here, once.
 * Order matters only within one table. Never rename or drop a column here.
 */
const ADDED_COLUMNS: Array<[table: string, column: string, ddl: string]> = [
  // Creator: age gate, Instagram avatar, the team's confirmation of the account.
  ['users', 'birth_date', 'TEXT'],
  ['users', 'avatar_url', 'TEXT'],
  ['users', 'account_status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['users', 'account_note', 'TEXT'],
  ['users', 'account_reviewed_by', 'INTEGER'],
  ['users', 'account_reviewed_at', 'TEXT'],
  ['users', 'market', "TEXT NOT NULL DEFAULT 'kz'"],
  // Tasks: the detailed brief, what is checked on a link, who sees the task.
  ['tasks', 'brief', 'TEXT'],
  ['tasks', 'formats', "TEXT NOT NULL DEFAULT '[]'"],
  ['tasks', 'required_mention', 'TEXT'],
  ['tasks', 'required_hashtag', 'TEXT'],
  ['tasks', 'starts_at', 'TEXT'],
  ['tasks', 'max_publications', 'INTEGER NOT NULL DEFAULT 1'],
  ['tasks', 'max_participants', 'INTEGER'],
  ['tasks', 'bonus_coins', 'INTEGER'],
  ['tasks', 'status', "TEXT NOT NULL DEFAULT 'active'"],
  ['tasks', 'audience', `TEXT NOT NULL DEFAULT '{"mode":"all"}'`],
  ['tasks', 'source', "TEXT NOT NULL DEFAULT 'seed'"],
  ['tasks', 'created_by', 'INTEGER'],
  ['tasks', 'created_at', 'TEXT'],
  ['tasks', 'updated_at', 'TEXT'],
  ['tasks', 'market', "TEXT NOT NULL DEFAULT 'kz'"],
  // Photos for events and news.
  ['events', 'cover_url', 'TEXT'],
  // The longer text of an event's own page: programme, what to bring, how to get there.
  ['events', 'details', 'TEXT'],
  ['news', 'cover_url', 'TEXT'],
  ['news', 'path', 'TEXT'],
  // Who moved an order or a payout, and when.
  ['orders', 'status_at', 'TEXT'],
  ['orders', 'status_by', 'INTEGER'],
  // The shop, managed on the admin site: a description, several photos (image_url stays the
  // first of them), the sizes on offer, how many are left, a limit per creator, how it is delivered.
  ['shop_items', 'description', 'TEXT'],
  ['shop_items', 'images', 'TEXT'],
  ['shop_items', 'sizes', 'TEXT'],
  ['shop_items', 'stock', 'INTEGER'],
  ['shop_items', 'per_creator', 'INTEGER'],
  ['shop_items', 'delivery', "TEXT NOT NULL DEFAULT 'courier'"],
  ['shop_items', 'source', "TEXT NOT NULL DEFAULT 'seed'"],
  ['shop_items', 'updated_at', 'TEXT'],
  // A choice that is not a size (the drink in a monthly case) with its own word, and a limit
  // per creator per calendar month, for things given out regularly.
  ['shop_items', 'choices', 'TEXT'],
  ['shop_items', 'choice_label', 'TEXT'],
  ['shop_items', 'per_month', 'INTEGER'],
  // An order remembers how it is delivered, and who cancelled it and why.
  ['orders', 'delivery', "TEXT NOT NULL DEFAULT 'courier'"],
  ['orders', 'cancelled_by', 'TEXT'],
  ['orders', 'cancel_note', 'TEXT'],
  ['cashouts', 'decided_at', 'TEXT'],
  ['cashouts', 'decided_by', 'INTEGER'],
  ['cashouts', 'note', 'TEXT'],
  // Creator workstream: where a publication's numbers came from (apify or demo), the second
  // request for story views, retries of a measurement, the detailed brief of a paid offer.
  ['publications', 'data_source', 'TEXT'],
  ['publications', 'story_reminded_at', 'TEXT'],
  ['snapshots', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['offers', 'brief', 'TEXT'],
  // The team's reply that is awaited: a comment on a work ('entry', entry_id is the entry) or the
  // reason for rejecting an account ('account', entry_id is the creator's id), and the bot message
  // to stamp once it arrives.
  ['admin_pending', 'kind', "TEXT NOT NULL DEFAULT 'entry'"],
  ['admin_pending', 'chat_id', 'INTEGER'],
  ['admin_pending', 'message_id', 'INTEGER'],
  ['admin_pending', 'message_text', 'TEXT'],
  // A publication that could not be found once: one more miss in a row marks it removed.
  ['publications', 'missed_at', 'TEXT'],
  // Admin: who invited someone from the admin site, and tags to put on them once they arrive.
  ['invites', 'invited_by', 'INTEGER'],
  ['invites', 'tags', 'TEXT'],
  ['invites', 'tags_applied_at', 'TEXT'],
  // Admin: a task is announced in the bot once, however often "publish and announce" is pressed.
  ['tasks', 'announced_at', 'TEXT'],
  // Admin: the team has looked at the story views a creator stated (kept or corrected them).
  ['publications', 'story_checked_at', 'TEXT'],
  ['publications', 'story_checked_by', 'INTEGER'],
];

export function migrate(db: DB): void {
  const known = new Map<string, Set<string>>();
  const columnsOf = (table: string): Set<string> => {
    let set = known.get(table);
    if (!set) {
      set = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
      known.set(table, set);
    }
    return set;
  };
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    if (columnsOf(table).has(column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    columnsOf(table).add(column);
  }
}

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const now = (): string => new Date().toISOString();

interface SeedFile {
  tasks?: Array<{
    id: string;
    title: string;
    summary?: string | null;
    brief?: string | null;
    coverUrl?: string | null;
    reward: number;
    format?: string | null;
    formats?: PublicationKind[];
    requiredMention?: string | null;
    requiredHashtag?: string | null;
    date?: string | null;
    place?: string | null;
    startsAt?: string | null;
    deadline: string;
    reviewMode?: ReviewMode;
    viewsBonus?: boolean;
    bonusCoins?: number | null;
    maxPublications?: number;
    steps?: string[];
  }>;
  events?: Array<{
    id: string;
    title: string;
    date?: string | null;
    time?: string | null;
    monthHint?: string | null;
    place?: string | null;
    description?: string | null;
    /** Plain text for the event's own page. Paragraphs split by a blank line; a short first line is a heading. */
    details?: string | null;
    coverUrl?: string | null;
    taskId?: string | null;
  }>;
  shop?: Array<{
    id: string;
    title: string;
    price: number;
    category?: 'merch' | 'gift';
    description?: string | null;
    imageUrl?: string | null;
    needsSize?: boolean;
    sizes?: string[];
    delivery?: 'courier' | 'message';
  }>;
  news?: Array<{
    id: string;
    title: string;
    summary?: string | null;
    date?: string | null;
    url?: string | null;
    /** A screen of the mini app to open, e.g. /events */
    path?: string | null;
    coverUrl?: string | null;
  }>;
}

/**
 * Mirrors content/seed.json into the database.
 *
 * Events and news: the file is the source of truth. Rows are upserted by id, and
 * anything removed from the file is hidden (never deleted, creators may reference it).
 *
 * Shop items: the file only seeds the shop. An item added or edited on the admin site
 * (its source becomes 'admin') is never touched here, and the file never changes how
 * many are left of anything.
 *
 * Tasks: the file only owns tasks whose source is 'seed'. A task created in the
 * admin panel, or a seed task the team has edited there (the admin sets its source
 * to 'admin'), is never touched here, so a restart cannot undo the team's work.
 */
export function syncContent(db: DB, file = resolve(rootDir, 'content/seed.json')): void {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as SeedFile;

  const run = db.transaction(() => {
    db.exec(
      "UPDATE tasks SET active = 0 WHERE source = 'seed'; UPDATE events SET active = 0; UPDATE shop_items SET active = 0 WHERE source = 'seed'; UPDATE news SET active = 0;",
    );

    const task = db.prepare(`
      INSERT INTO tasks (id, title, summary, brief, cover_url, reward, format, formats, required_mention, required_hashtag,
        date, place, starts_at, deadline, review_mode, views_bonus, bonus_coins, max_publications, steps, sort, active,
        status, source, created_at)
      VALUES (@id, @title, @summary, @brief, @coverUrl, @reward, @format, @formats, @requiredMention, @requiredHashtag,
        @date, @place, @startsAt, @deadline, @reviewMode, @viewsBonus, @bonusCoins, @maxPublications, @steps, @sort, 1,
        'active', 'seed', @now)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, brief=excluded.brief,
        cover_url=excluded.cover_url, reward=excluded.reward, format=excluded.format, formats=excluded.formats,
        required_mention=excluded.required_mention, required_hashtag=excluded.required_hashtag, date=excluded.date,
        place=excluded.place, starts_at=excluded.starts_at, deadline=excluded.deadline, review_mode=excluded.review_mode,
        views_bonus=excluded.views_bonus, bonus_coins=excluded.bonus_coins, max_publications=excluded.max_publications,
        steps=excluded.steps, sort=excluded.sort, active=1
      WHERE tasks.source = 'seed'`);
    (seed.tasks ?? []).forEach((t, sort) =>
      task.run({
        id: t.id,
        title: t.title,
        summary: t.summary ?? null,
        brief: t.brief ?? null,
        coverUrl: t.coverUrl ?? null,
        reward: t.reward,
        format: t.format ?? null,
        formats: JSON.stringify(t.formats ?? []),
        requiredMention: t.requiredMention ?? null,
        requiredHashtag: t.requiredHashtag ?? null,
        date: t.date ?? null,
        place: t.place ?? null,
        startsAt: t.startsAt ?? null,
        deadline: t.deadline,
        reviewMode: t.reviewMode ?? 'post_first',
        viewsBonus: t.viewsBonus ? 1 : 0,
        bonusCoins: t.bonusCoins ?? null,
        maxPublications: t.maxPublications ?? 1,
        steps: JSON.stringify(t.steps ?? []),
        sort,
        now: now(),
      }),
    );

    const event = db.prepare(`
      INSERT INTO events (id, title, date, time, month_hint, place, description, details, cover_url, task_id, sort, active)
      VALUES (@id, @title, @date, @time, @monthHint, @place, @description, @details, @coverUrl, @taskId, @sort, 1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, time=excluded.time, month_hint=excluded.month_hint,
        place=excluded.place, description=excluded.description, details=excluded.details, cover_url=excluded.cover_url,
        task_id=excluded.task_id, sort=excluded.sort, active=1`);
    (seed.events ?? []).forEach((e, sort) =>
      event.run({
        id: e.id,
        title: e.title,
        date: e.date ?? null,
        time: e.time ?? null,
        monthHint: e.monthHint ?? null,
        place: e.place ?? null,
        description: e.description ?? null,
        details: e.details ?? null,
        coverUrl: e.coverUrl ?? null,
        taskId: e.taskId ?? null,
        sort,
      }),
    );

    const item = db.prepare(`
      INSERT INTO shop_items (id, title, price, category, image_url, images, needs_size, sizes, description, delivery, sort, active, source)
      VALUES (@id, @title, @price, @category, @imageUrl, @images, @needsSize, @sizes, @description, @delivery, @sort, 1, 'seed')
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, price=excluded.price, category=excluded.category,
        image_url=excluded.image_url, images=excluded.images, needs_size=excluded.needs_size, sizes=excluded.sizes,
        description=excluded.description, delivery=excluded.delivery, sort=excluded.sort, active=1
      WHERE shop_items.source = 'seed'`);
    (seed.shop ?? []).forEach((s, sort) =>
      item.run({
        id: s.id,
        title: s.title,
        price: s.price,
        category: s.category ?? 'merch',
        imageUrl: s.imageUrl ?? null,
        images: s.imageUrl ? JSON.stringify([s.imageUrl]) : null,
        needsSize: s.needsSize || s.sizes?.length ? 1 : 0,
        sizes: s.sizes?.length ? JSON.stringify(s.sizes) : null,
        description: s.description ?? null,
        delivery: s.delivery ?? 'courier',
        sort,
      }),
    );

    const news = db.prepare(`
      INSERT INTO news (id, title, summary, date, url, path, cover_url, sort, active)
      VALUES (@id, @title, @summary, @date, @url, @path, @coverUrl, @sort, 1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, date=excluded.date,
        url=excluded.url, path=excluded.path, cover_url=excluded.cover_url, sort=excluded.sort, active=1`);
    (seed.news ?? []).forEach((n, sort) =>
      news.run({
        id: n.id,
        title: n.title,
        summary: n.summary ?? null,
        date: n.date ?? null,
        url: n.url ?? null,
        path: n.path ?? null,
        coverUrl: n.coverUrl ?? null,
        sort,
      }),
    );
  });
  run();
}

// --- Creator workstream rows -------------------------------------------------

/** A Telegram id refused for age. Nothing else about that person is kept. */
export interface AgeRefusalRow {
  telegram_id: number;
  created_at: string;
}

export type LookupStatus = 'searching' | 'ok' | 'private' | 'not_found' | 'error';

/** The creator's latest "Find my profile", while they look at it and before they confirm. */
export interface SocialLookupRow {
  user_id: number;
  platform: Platform;
  handle: string;
  /** Random id of the latest attempt: a slow answer to an older attempt is dropped. */
  attempt: string;
  status: LookupStatus;
  /** JSON: ProfileData plus avatarPath (our own copy), when status is 'ok'. */
  result: string | null;
  started_at: string;
  finished_at: string | null;
  /** Lookups cost money: how many this creator started on `day` (YYYY-MM-DD). */
  day: string;
  count: number;
}

export type SubmissionStatus = 'checking' | 'blocked' | 'done';

/** One "Send for review" while its links are being checked, before anything reaches the team. */
export interface SubmissionRow {
  id: number;
  entry_id: number;
  user_id: number;
  task_id: string;
  /** JSON array of links */
  links: string;
  note: string | null;
  status: SubmissionStatus;
  /** JSON array of BlockedLink when status is 'blocked' */
  result: string;
  tries: number;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

/** Our copy of a remote seed photo. status 'failed' keeps the remote address in use. */
export interface MediaCopyRow {
  remote_url: string;
  url: string | null;
  status: 'ok' | 'failed' | 'standin';
  tried_at: string;
}
