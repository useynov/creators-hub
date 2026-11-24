import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const MEDIA = mkdtempSync(join(tmpdir(), 'hub-photos-'));
process.env.MEDIA_DIR = MEDIA;

const { openDb, syncContent } = await import('./db.js');
const { localizeSeedPhotos, remoteSeedPhotos } = await import('./photos.js');

const db = openDb(':memory:');
syncContent(db);

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const cover = (id: string) => (db.prepare('SELECT cover_url AS url FROM tasks WHERE id = ?').get(id) as { url: string }).url;
const image = (id: string) => (db.prepare('SELECT image_url AS url FROM shop_items WHERE id = ?').get(id) as { url: string }).url;

test('seed photos: copied once into the public zone; a failed copy keeps the remote address', async () => {
  const remote = remoteSeedPhotos(db);
  assert.ok(remote.length >= 6, 'tasks, events, shop and news carry remote photos');
  const caravanRemote = cover('caravan-shoot');
  const hoodieRemote = image('hoodie');
  assert.ok(caravanRemote.startsWith('https://'));

  const asked: string[] = [];
  const download = async (url: string) => {
    asked.push(url);
    if (url === hoodieRemote) return null; // the CDN refuses this one
    if (url === caravanRemote) return Buffer.from('<html>not a picture</html> with padding'); // a disguised page
    return jpeg;
  };
  const first = await localizeSeedPhotos(db, download);
  assert.equal(first.failed, 2);
  assert.equal(first.copied, remote.length - 2);
  assert.equal(asked.length, remote.length, 'one download per distinct address (news and event share one)');

  const local = cover('new-year-post');
  assert.match(local, /^\/media\/seed\/[0-9a-f]{24}\.jpg$/);
  assert.ok(existsSync(join(MEDIA, 'public', local.slice('/media/'.length))));
  assert.equal(image('hoodie'), hoodieRemote, 'a failed copy keeps the remote address');
  assert.equal(cover('caravan-shoot'), caravanRemote, 'a file that is not a picture is never stored');
  const party = db.prepare(`SELECT e.cover_url AS event, n.cover_url AS news FROM events e, news n WHERE e.id = 'creators-ny-party' AND n.id = 'creators-ny-party'`).get() as { event: string; news: string };
  assert.equal(party.event, party.news, 'the same photo is one copy');

  // A restart: the sync puts the remote addresses back, the copies are applied again without
  // downloading, and failed copies are not retried on every start.
  syncContent(db);
  assert.ok(cover('new-year-post').startsWith('https://'));
  asked.length = 0;
  const second = await localizeSeedPhotos(db, download);
  assert.deepEqual([second.copied, second.failed, asked.length], [0, 0, 0]);
  assert.equal(cover('new-year-post'), local);

  // A day later the failed ones are tried again.
  db.prepare(`UPDATE media_copies SET tried_at = '2000-01-01T00:00:00.000Z' WHERE status = 'failed'`).run();
  const third = await localizeSeedPhotos(db, async () => jpeg);
  assert.equal(third.copied, 2);
  assert.match(image('hoodie'), /^\/media\/seed\//);
});

test('seed photos: tasks edited by the team are not touched', async () => {
  db.prepare(`UPDATE tasks SET source = 'admin', cover_url = 'https://elsewhere.example/team.jpg' WHERE id = 'new-year-table-reel'`).run();
  await localizeSeedPhotos(db, async () => jpeg);
  assert.equal(cover('new-year-table-reel'), 'https://elsewhere.example/team.jpg');
});

test('seed photos: the real downloader fails quietly when the network refuses', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('Forbidden', { status: 403 })) as typeof fetch;
  try {
    db.prepare(`DELETE FROM media_copies`).run();
    syncContent(db);
    const result = await localizeSeedPhotos(db);
    assert.equal(result.copied, 0);
    assert.ok(result.failed > 0);
    assert.ok(cover('caravan-shoot').startsWith('https://'));
  } finally {
    globalThis.fetch = realFetch;
  }
});
