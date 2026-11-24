// Where the creator side and the admin side meet: pictures made light for phones, the roles
// from the admin site at work in the bot, and invitation tags reaching a creator's tasks.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-integration-'));
delete process.env.DEV_USER_ID;
delete process.env.ADMIN_CHAT_ID;

const { openDb, now } = await import('./db.js');
const { saveMedia, readMedia, sniff } = await import('./media.js');
const { isManagerOnly, isOwner, isTeam, setDemoMode, teamChats } = await import('./team.js');
const { applyInviteTags, tagsOf, refreshProfile } = await import('./account.js');
const { setProvider } = await import('./social/index.js');
const sharp = (await import('sharp')).default;

const db = openDb(':memory:');

/** A noisy photo-like picture: noise does not compress away, so the file is honestly large. */
async function photo(width: number, height: number, format: 'png' | 'jpeg'): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 20261123;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    raw[i] = seed >>> 24;
  }
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 95 }).toBuffer();
}

test('pictures for the public zone are made light: no larger than shown, WebP, a real image', async () => {
  const original = await photo(1600, 900, 'png');
  const saved = await saveMedia('public', 'covers', original, { allow: ['jpg', 'png', 'webp'] });
  assert.match(saved.path, /^covers\/[0-9a-f]{24}\.webp$/);
  assert.equal(saved.url, `/media/${saved.path}`);
  assert.equal(saved.mime, 'image/webp');
  assert.ok(saved.bytes < original.length, 'the stored file is smaller than the upload');

  const stored = await readMedia('public', saved.path);
  assert.ok(stored);
  assert.equal(sniff(stored.data)?.ext, 'webp');
  const meta = await sharp(stored.data).metadata();
  assert.equal(meta.width, 1280);
  assert.equal(meta.height, 720);

  const avatar = await saveMedia('public', 'avatars', await photo(1080, 1080, 'jpeg'), { allow: ['jpg', 'png', 'webp'] });
  assert.equal((await sharp((await readMedia('public', avatar.path))!.data).metadata()).width, 320);
});

test('a small picture is never blown up, and what is not a real image is kept as it came', async () => {
  const small = await photo(200, 120, 'jpeg');
  const saved = await saveMedia('public', 'covers', small, { allow: ['jpg', 'png', 'webp'] });
  const meta = await sharp((await readMedia('public', saved.path))!.data).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 120);

  // The right first bytes but nothing behind them: stored unchanged under its own type, no crash.
  const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  const kept = await saveMedia('public', 'seed', broken, { allow: ['jpg', 'png', 'webp'] });
  assert.match(kept.path, /\.jpg$/);
  assert.deepEqual((await readMedia('public', kept.path))!.data, broken);
});

test('private files, the story copies and statistics screenshots, are stored exactly as they came', async () => {
  const screenshot = await photo(1170, 2532, 'png');
  const saved = await saveMedia('private', 'screens', screenshot, { maxBytes: 30 * 1024 * 1024, allow: ['jpg', 'png', 'webp'] });
  assert.match(saved.path, /\.png$/);
  assert.equal(saved.url, null);
  assert.deepEqual((await readMedia('private', saved.path))!.data, screenshot);
});

test('a route that does not accept WebP keeps the type it was given', async () => {
  const saved = await saveMedia('public', 'covers', await photo(1600, 800, 'png'), { allow: ['png'] });
  assert.match(saved.path, /\.png$/);
});

test('team roles from the admin site work in the bot: Owner and Manager yes, Viewer no', () => {
  const add = (id: number, role: string) =>
    db.prepare('INSERT INTO team_members (telegram_id, name, role, created_at) VALUES (?, ?, ?, ?)').run(id, `Member ${id}`, role, now());
  add(901, 'manager');
  add(902, 'viewer');
  add(903, 'owner');

  assert.ok(isTeam(db, 900), 'an owner from the server settings');
  assert.ok(isTeam(db, 901), 'a Manager reviews in the bot');
  assert.ok(isTeam(db, 903));
  assert.ok(!isTeam(db, 902), 'a Viewer only reads reports on the site');
  assert.ok(!isTeam(db, 555), 'a stranger');

  assert.ok(isOwner(db, 900) && isOwner(db, 903));
  assert.ok(!isOwner(db, 901) && !isOwner(db, 902));
  assert.ok(isManagerOnly(db, 901), 'coins, levels and offers stay with the owners');
  assert.ok(!isManagerOnly(db, 900) && !isManagerOnly(db, 903) && !isManagerOnly(db, 902));

  assert.deepEqual(teamChats(db).sort(), [900, 901, 903], 'the team’s messages reach owners and managers, never a Viewer');

  // Taken off the team on the site: out of the bot at once.
  db.prepare('DELETE FROM team_members WHERE telegram_id = 901').run();
  assert.ok(!isTeam(db, 901));
  assert.deepEqual(teamChats(db).sort(), [900, 903]);
  assert.equal(setDemoMode(db, false), undefined);
});

test('tags chosen at invitation reach the creator once they are in the Hub, and only once', () => {
  db.prepare(`INSERT INTO users (id, username, first_name, created_at) VALUES (2001, 'aika', 'Aika', ?)`).run(now());
  db.prepare(`INSERT INTO invites (telegram_id, tags, created_at) VALUES (2001, ?, ?)`).run(JSON.stringify(['Food', 'almaty-core']), now());
  db.prepare(`INSERT INTO invites (telegram_id, tags, created_at) VALUES (2002, ?, ?)`).run(JSON.stringify(['later']), now());

  applyInviteTags(db);
  assert.deepEqual(tagsOf(db, 2001), ['almaty-core', 'food']);
  assert.deepEqual(tagsOf(db, 2002), [], 'nobody with this id has opened the bot yet');

  // The team removes a tag on the creator's card: a later run does not bring it back.
  db.prepare(`DELETE FROM user_tags WHERE user_id = 2001 AND tag = 'food'`).run();
  applyInviteTags(db);
  assert.deepEqual(tagsOf(db, 2001), ['almaty-core']);

  db.prepare(`INSERT INTO users (id, username, first_name, created_at) VALUES (2002, 'dana', 'Dana', ?)`).run(now());
  applyInviteTags(db);
  assert.deepEqual(tagsOf(db, 2002), ['later']);
});

test('a profile refresh fills in the average reel views from the second reader', async () => {
  db.prepare(`INSERT INTO users (id, username, first_name, instagram, birth_date, onboarded_at, created_at) VALUES (3001, 'mira', 'Mira', 'mira.films', '1998-02-02', ?, ?)`).run(now(), now());
  db.prepare(`INSERT INTO social_profiles (user_id, platform, handle, status, source, fetched_at) VALUES (3001, 'instagram', 'mira.films', 'ok', 'apify', ?)`).run(now());
  const post = (code: string, kind: 'post' | 'reel', day: string) => ({
    url: `https://www.instagram.com/p/${code}/`,
    kind,
    publishedAt: `2026-11-${day}T10:00:00.000Z`,
    views: null,
    likes: 200,
    comments: 0,
    thumbUrl: null,
  });
  const asked: string[] = [];
  setProvider({
    name: 'apify',
    // As the real profile reader answers: recent posts, reels among them, none with views.
    fetchProfile: async () => ({
      status: 'ok',
      profile: {
        platform: 'instagram', handle: 'mira.films', externalId: '1', fullName: 'Mira', bio: null, avatarUrl: null,
        followers: 10_000, following: 10, postsCount: 3, isPrivate: false, isVerified: false,
        recent: [post('A', 'reel', '20'), post('B', 'post', '19'), post('C', 'reel', '18')],
      },
    }),
    fetchPost: async () => ({ status: 'gone' }),
    fetchReels: async (handle, limit) => {
      asked.push(`${handle}:${limit}`);
      return [{ ...post('A', 'reel', '20'), views: 30_000 }, { ...post('C', 'reel', '18'), views: 10_000 }];
    },
  });
  try {
    const row = await refreshProfile(db, 3001, 'instagram');
    assert.deepEqual(asked, ['mira.films:12']);
    assert.equal(row?.avg_reel_views, 20_000, 'the average of the two reels, the photo post has no views');
    assert.equal(row?.engagement_rate, 2, '200 likes on 10,000 followers');

    // The second reader fails: the profile is still stored, only without the average.
    setProvider({
      name: 'apify',
      fetchProfile: async () => ({
        status: 'ok',
        profile: {
          platform: 'instagram', handle: 'mira.films', externalId: '1', fullName: 'Mira', bio: null, avatarUrl: null,
          followers: 12_000, following: 10, postsCount: 3, isPrivate: false, isVerified: false, recent: [post('A', 'reel', '20')],
        },
      }),
      fetchPost: async () => ({ status: 'gone' }),
      fetchReels: async () => {
        throw new Error('quota');
      },
    });
    const again = await refreshProfile(db, 3001, 'instagram');
    assert.equal(again?.followers, 12_000);
    assert.equal(again?.avg_reel_views, null);
  } finally {
    setProvider(null);
  }
});
