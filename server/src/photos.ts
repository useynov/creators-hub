// Seed photos (task covers, events, shop items, news) are remote addresses in content/seed.json.
// Remote pictures disappear or move, so on start-up each one is copied into the public media
// zone once and the row points at our copy. When a copy fails the row keeps the remote address:
// the app shows it if it loads and a calm fallback if it does not.
//
// syncContent puts the remote addresses back on every start, so the copies are remembered in
// `media_copies` and simply applied again.

import { now, type DB, type MediaCopyRow } from './db.js';
import { downloadMedia, saveMedia } from './media.js';

/** Where seed photos live: table, column, and which rows belong to the seed file. */
const PHOTO_COLUMNS: Array<{ table: string; column: string; where: string }> = [
  { table: 'tasks', column: 'cover_url', where: "source = 'seed'" },
  { table: 'events', column: 'cover_url', where: '1 = 1' },
  { table: 'shop_items', column: 'image_url', where: '1 = 1' },
  { table: 'news', column: 'cover_url', where: '1 = 1' },
];

/** A failed copy is tried again after this long, not on every start. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export function remoteSeedPhotos(db: DB): string[] {
  const urls = new Set<string>();
  for (const { table, column, where } of PHOTO_COLUMNS) {
    const rows = db.prepare(`SELECT ${column} AS url FROM ${table} WHERE ${where} AND ${column} LIKE 'https://%'`).all() as Array<{ url: string }>;
    for (const row of rows) urls.add(row.url);
  }
  return [...urls];
}

/** Points every row that still holds a remote address at our copy of it, where we have one. */
export function applyPhotoCopies(db: DB): number {
  let changed = 0;
  for (const { table, column, where } of PHOTO_COLUMNS) {
    changed += db
      .prepare(
        `UPDATE ${table} SET ${column} = (SELECT url FROM media_copies m WHERE m.remote_url = ${table}.${column})
         WHERE ${where} AND ${column} IN (SELECT remote_url FROM media_copies WHERE status IN ('ok', 'standin') AND url IS NOT NULL)`,
      )
      .run().changes;
  }
  return changed;
}

/**
 * Copies every remote seed photo we do not have yet, then applies the copies.
 * `download` is injectable for tests. Never throws for a bad picture.
 */
export async function localizeSeedPhotos(
  db: DB,
  download: (url: string) => Promise<Buffer | null> = (url) => downloadMedia(url, 8 * 1024 * 1024),
): Promise<{ copied: number; failed: number }> {
  let copied = 0;
  let failed = 0;
  for (const remote of remoteSeedPhotos(db)) {
    const known = db.prepare('SELECT * FROM media_copies WHERE remote_url = ?').get(remote) as MediaCopyRow | undefined;
    if (known?.status === 'ok') continue;
    if (known && Date.now() - new Date(known.tried_at).getTime() < RETRY_AFTER_MS) continue;

    const bytes = await download(remote);
    let url: string | null = null;
    if (bytes) {
      try {
        url = (await saveMedia('public', 'seed', bytes, { allow: ['jpg', 'png', 'webp'] })).url;
      } catch {
        url = null;
      }
    }
    if (url) {
      copied++;
      db.prepare(
        `INSERT INTO media_copies (remote_url, url, status, tried_at) VALUES (?, ?, 'ok', ?)
         ON CONFLICT(remote_url) DO UPDATE SET url = excluded.url, status = 'ok', tried_at = excluded.tried_at`,
      ).run(remote, url, now());
    } else {
      failed++;
      // A development stand-in stays in place until a real copy succeeds.
      db.prepare(
        `INSERT INTO media_copies (remote_url, url, status, tried_at) VALUES (?, NULL, 'failed', ?)
         ON CONFLICT(remote_url) DO UPDATE SET tried_at = excluded.tried_at`,
      ).run(remote, now());
    }
  }
  applyPhotoCopies(db);
  return { copied, failed };
}
