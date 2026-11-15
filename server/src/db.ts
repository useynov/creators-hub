import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { rootDir } from './config.js';
import type { EntryStatus, Level, ReviewMode } from './types.js';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE,
  username TEXT UNIQUE COLLATE NOCASE,
  note TEXT,
  created_at TEXT NOT NULL
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
`;

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
}

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export const now = (): string => new Date().toISOString();

interface SeedFile {
  tasks?: Array<{
    id: string;
    title: string;
    summary?: string | null;
    coverUrl?: string | null;
    reward: number;
    format?: string | null;
    date?: string | null;
    place?: string | null;
    deadline: string;
    reviewMode?: ReviewMode;
    viewsBonus?: boolean;
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
    taskId?: string | null;
  }>;
  shop?: Array<{
    id: string;
    title: string;
    price: number;
    category?: 'merch' | 'gift';
    imageUrl?: string | null;
    needsSize?: boolean;
  }>;
  news?: Array<{
    id: string;
    title: string;
    summary?: string | null;
    date?: string | null;
    url?: string | null;
  }>;
}

/**
 * Mirrors content/seed.json into the database. The file is the source of truth
 * for tasks, events, shop items and news: rows are upserted by id, and anything
 * removed from the file is hidden (never deleted, creators may reference it).
 */
export function syncContent(db: DB, file = resolve(rootDir, 'content/seed.json')): void {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as SeedFile;

  const run = db.transaction(() => {
    db.exec('UPDATE tasks SET active = 0; UPDATE events SET active = 0; UPDATE shop_items SET active = 0; UPDATE news SET active = 0;');

    const task = db.prepare(`
      INSERT INTO tasks (id, title, summary, cover_url, reward, format, date, place, deadline, review_mode, views_bonus, steps, sort, active)
      VALUES (@id, @title, @summary, @coverUrl, @reward, @format, @date, @place, @deadline, @reviewMode, @viewsBonus, @steps, @sort, 1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, cover_url=excluded.cover_url,
        reward=excluded.reward, format=excluded.format, date=excluded.date, place=excluded.place, deadline=excluded.deadline,
        review_mode=excluded.review_mode, views_bonus=excluded.views_bonus, steps=excluded.steps, sort=excluded.sort, active=1`);
    (seed.tasks ?? []).forEach((t, sort) =>
      task.run({
        id: t.id,
        title: t.title,
        summary: t.summary ?? null,
        coverUrl: t.coverUrl ?? null,
        reward: t.reward,
        format: t.format ?? null,
        date: t.date ?? null,
        place: t.place ?? null,
        deadline: t.deadline,
        reviewMode: t.reviewMode ?? 'post_first',
        viewsBonus: t.viewsBonus ? 1 : 0,
        steps: JSON.stringify(t.steps ?? []),
        sort,
      }),
    );

    const event = db.prepare(`
      INSERT INTO events (id, title, date, time, month_hint, place, description, task_id, sort, active)
      VALUES (@id, @title, @date, @time, @monthHint, @place, @description, @taskId, @sort, 1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, time=excluded.time, month_hint=excluded.month_hint,
        place=excluded.place, description=excluded.description, task_id=excluded.task_id, sort=excluded.sort, active=1`);
    (seed.events ?? []).forEach((e, sort) =>
      event.run({
        id: e.id,
        title: e.title,
        date: e.date ?? null,
        time: e.time ?? null,
        monthHint: e.monthHint ?? null,
        place: e.place ?? null,
        description: e.description ?? null,
        taskId: e.taskId ?? null,
        sort,
      }),
    );

    const item = db.prepare(`
      INSERT INTO shop_items (id, title, price, category, image_url, needs_size, sort, active)
      VALUES (@id, @title, @price, @category, @imageUrl, @needsSize, @sort, 1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, price=excluded.price, category=excluded.category,
        image_url=excluded.image_url, needs_size=excluded.needs_size, sort=excluded.sort, active=1`);
    (seed.shop ?? []).forEach((s, sort) =>
      item.run({
        id: s.id,
        title: s.title,
        price: s.price,
        category: s.category ?? 'merch',
        imageUrl: s.imageUrl ?? null,
        needsSize: s.needsSize ? 1 : 0,
        sort,
      }),
    );

    const news = db.prepare(`
      INSERT INTO news (id, title, summary, date, url, sort, active)
      VALUES (@id, @title, @summary, @date, @url, @sort, 1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, date=excluded.date,
        url=excluded.url, sort=excluded.sort, active=1`);
    (seed.news ?? []).forEach((n, sort) =>
      news.run({ id: n.id, title: n.title, summary: n.summary ?? null, date: n.date ?? null, url: n.url ?? null, sort }),
    );
  });
  run();
}
