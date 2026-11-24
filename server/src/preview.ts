// Development preview (DEV_USER_ID, never in production): a believable Hub for that one user,
// so every screen can be looked at in a normal browser. Runs once per database.
//
// What it sets up: a connected and confirmed Instagram account with an avatar, entries in every
// status, publications with their measurements, a story waiting for its views, a refused link,
// coins, an order, an RSVP, a few other creators on the leaderboard, and the paid offer example
// (with a Partner level override so the offer is visible).
//
// Photos: this machine may not reach the remote seed photos. When PREVIEW_PHOTOS points at a
// folder of stand-in pictures, they fill in for the copies that failed (see photos.ts).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { now, type DB, type SnapshotKind } from './db.js';
import { saveMedia } from './media.js';
import { applyPhotoCopies, localizeSeedPhotos, remoteSeedPhotos } from './photos.js';

const HOUR = 60 * 60 * 1000;
const ago = (hours: number): string => new Date(Date.now() - hours * HOUR).toISOString();
const ahead = (days: number): string => new Date(Date.now() + days * 24 * HOUR).toISOString();

let seeding: Promise<void> | null = null;

export function seedPreview(db: DB, userId: number): Promise<void> {
  if (config.isProd || !config.previewSeed || config.devUserId !== userId) return Promise.resolve();
  seeding ??= seed(db, userId).catch((error: unknown) => console.error('[preview] seeding failed:', (error as Error).message));
  return seeding;
}

/** A stand-in picture from PREVIEW_PHOTOS, copied into the media zone. */
async function standIn(name: string, zone: 'public' | 'private' = 'public'): Promise<{ url: string | null; path: string } | null> {
  if (!config.previewPhotosDir) return null;
  try {
    const bytes = await readFile(join(config.previewPhotosDir, name));
    const saved = await saveMedia(zone, zone === 'public' ? 'seed' : 'stories', bytes, { allow: ['jpg', 'png', 'webp'] });
    return { url: saved.url, path: saved.path };
  } catch {
    return null;
  }
}

/** Stand-ins for the seed photos this machine could not copy, matched by row id. */
async function standInSeedPhotos(db: DB): Promise<void> {
  await localizeSeedPhotos(db);
  const rows = [
    ...(db.prepare(`SELECT 'task' AS kind, id, cover_url AS url FROM tasks`).all() as Array<{ kind: string; id: string; url: string | null }>),
    ...(db.prepare(`SELECT 'event' AS kind, id, cover_url AS url FROM events`).all() as Array<{ kind: string; id: string; url: string | null }>),
    ...(db.prepare(`SELECT 'shop' AS kind, id, image_url AS url FROM shop_items`).all() as Array<{ kind: string; id: string; url: string | null }>),
    ...(db.prepare(`SELECT 'news' AS kind, id, cover_url AS url FROM news`).all() as Array<{ kind: string; id: string; url: string | null }>),
  ];
  const remote = new Set(remoteSeedPhotos(db));
  for (const row of rows) {
    if (!row.url || !remote.has(row.url)) continue;
    const picture = await standIn(`${row.kind}-${row.id}.jpg`);
    if (!picture?.url) continue;
    db.prepare(
      `INSERT INTO media_copies (remote_url, url, status, tried_at) VALUES (?, ?, 'standin', ?)
       ON CONFLICT(remote_url) DO UPDATE SET url = excluded.url, status = 'standin' WHERE media_copies.status != 'ok'`,
    ).run(row.url, picture.url, now());
  }
  applyPhotoCopies(db);
}

async function seed(db: DB, userId: number): Promise<void> {
  await standInSeedPhotos(db);
  if (db.prepare(`SELECT 1 FROM meta WHERE key = 'preview_seeded'`).get()) return;

  const avatar = await standIn('avatar.jpg');
  const storyCopy = await standIn('story.jpg', 'private');
  const covers = {
    coffee: await standIn('task-preview-coffee.jpg'),
    rink: await standIn('task-preview-ice-rink.jpg'),
    story: await standIn('task-preview-winter-story.jpg'),
    gift: await standIn('task-preview-gift-unboxing.jpg'),
  };

  db.transaction(() => {
    const stamp = now();
    db.prepare(
      `INSERT INTO users (id, username, first_name, instagram, city, created_at) VALUES (?, 'aruzhan', 'Aruzhan', 'aruzhan.vibes', 'Almaty', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(userId, ago(24 * 30));
    db.prepare(
      `UPDATE users SET first_name = 'Aruzhan', instagram = 'aruzhan.vibes', city = 'Almaty', birth_date = '2000-05-14',
         avatar_url = ?, account_status = 'confirmed', account_reviewed_by = 0, account_reviewed_at = ?,
         onboarded_at = COALESCE(onboarded_at, ?), level_override = 'partner', size = 'M' WHERE id = ?`,
    ).run(avatar?.url ?? null, ago(24 * 29), ago(24 * 30), userId);
    db.prepare(
      `INSERT OR REPLACE INTO social_profiles (user_id, platform, handle, external_id, full_name, bio, avatar_url, followers, following,
         posts_count, is_private, is_verified, avg_reel_views, engagement_rate, recent, status, source, fetched_at)
       VALUES (?, 'instagram', 'aruzhan.vibes', '4815162342', 'Aruzhan', 'Almaty · food, friends and winter walks', ?, 2840, 512,
         214, 0, 0, 3120, 6.1, '[]', 'ok', 'demo', ?)`,
    ).run(userId, avatar?.url ?? null, stamp);

    // Extra tasks, so that every status has a home. Marked 'admin' so the seed sync leaves them alone.
    const task = db.prepare(
      `INSERT OR IGNORE INTO tasks (id, title, summary, brief, cover_url, reward, format, formats, required_mention, required_hashtag,
         starts_at, deadline, review_mode, views_bonus, steps, sort, active, status, audience, source, created_by, created_at, max_publications)
       VALUES (@id, @title, @summary, @brief, @cover, @reward, @format, @formats, 'cocacola_kaz', @hashtag, @starts, @deadline, @mode, 0,
         @steps, @sort, 1, 'active', '{"mode":"all"}', 'admin', 0, @now, 1)`,
    );
    const extra = [
      { id: 'preview-coffee', title: 'Winter coffee break', mode: 'post_first', format: 'Reel', formats: '["reel"]', reward: 10, cover: covers.coffee, hashtag: null },
      { id: 'preview-ice-rink', title: 'A day at the ice rink', mode: 'draft_first', format: 'Reel', formats: '["reel"]', reward: 20, cover: covers.rink, hashtag: null },
      { id: 'preview-winter-story', title: 'Winter walk story', mode: 'post_first', format: 'Story', formats: '["story"]', reward: 5, cover: covers.story, hashtag: 'coke_winter' },
      { id: 'preview-gift-unboxing', title: 'Unbox the New Year gift', mode: 'post_first', format: 'Reel or post', formats: '["reel","post"]', reward: 15, cover: covers.gift, hashtag: null },
    ];
    extra.forEach((item, index) =>
      task.run({
        id: item.id,
        title: item.title,
        summary: 'A short task for the preview.',
        brief: 'What it is\nA short sample task, so that this preview shows every state of the Hub.\n\nMust have\nCoca-Cola in the frame.\nTag @cocacola_kaz.',
        cover: item.cover?.url ?? null,
        reward: item.reward,
        format: item.format,
        formats: item.formats,
        hashtag: item.hashtag,
        starts: ago(24 * 10),
        deadline: ahead(20 + index),
        mode: item.mode,
        steps: JSON.stringify(['Shoot it your way.', 'Tag @cocacola_kaz.', 'Send us the link.']),
        sort: 10 + index,
        now: stamp,
      }),
    );

    const entry = db.prepare(
      `INSERT INTO entries (user_id, task_id, status, joined_at, links, submitted_at, draft_link, draft_sent_at, draft_approved_at,
         comment, comment_at, score, views, approved_at, reward, rating_delta)
       VALUES (@user, @task, @status, @joined, @links, @submitted, @draftLink, @draftSent, @draftApproved, @comment, @commentAt,
         @score, @views, @approved, @reward, @delta)`,
    );
    const add = (values: Partial<Record<string, unknown>> & { task: string; status: string }, user = userId): number =>
      Number(
        entry.run({
          user,
          joined: ago(72),
          links: '[]',
          submitted: null,
          draftLink: null,
          draftSent: null,
          draftApproved: null,
          comment: null,
          commentAt: null,
          score: null,
          views: 0,
          approved: null,
          reward: null,
          delta: null,
          ...values,
        }).lastInsertRowid,
      );

    const reelUrl = 'https://www.instagram.com/aruzhan.vibes/reel/DPrevNY2026/';
    const approvedId = add({ task: 'new-year-post', status: 'approved', links: JSON.stringify([reelUrl]), submitted: ago(24 * 8), approved: ago(24 * 7), score: 5, views: 12480, reward: 15, delta: 59 });
    const storyUrl = 'https://www.instagram.com/stories/aruzhan.vibes/3790000000000000001/';
    const reviewId = add({ task: 'caravan-shoot', status: 'in_review', links: JSON.stringify([storyUrl]), submitted: ago(26) });
    add({ task: 'new-year-table-reel', status: 'draft_review', draftLink: 'https://drive.google.com/file/d/preview-draft/view', draftSent: ago(5) });
    const changesId = add({
      task: 'preview-coffee',
      status: 'needs_changes',
      links: JSON.stringify(['https://www.instagram.com/aruzhan.vibes/reel/DPrevCoffee1/']),
      submitted: ago(30),
      views: 2140,
      comment: 'Lovely mood! The bottle is hard to see at the start. Could you add a close-up in the first seconds?',
      commentAt: ago(20),
    });
    add({ task: 'preview-ice-rink', status: 'draft_approved', draftLink: 'https://drive.google.com/file/d/preview-rink/view', draftSent: ago(50), draftApproved: ago(40) });
    const joinedId = add({ task: 'preview-winter-story', status: 'joined' });

    // Publications and their measurements.
    const publication = db.prepare(
      `INSERT INTO publications (entry_id, user_id, task_id, url, platform, kind, external_id, author_handle, published_at, mentions, hashtags,
         media_path, checks, status, views, likes, comments, views_source, story_asked_at, created_at, data_source)
       VALUES (@entry, @user, @task, @url, 'instagram', @kind, @external, 'aruzhan.vibes', @published, '["cocacola_kaz"]', '[]',
         @media, @checks, 'tracking', @views, @likes, @comments, @source, @asked, @created, 'demo')`,
    );
    const allPass = JSON.stringify({ ownAccount: 'pass', afterStart: 'pass', mention: 'pass', hashtag: 'pass', format: 'pass', reachable: 'pass' });
    const reel = Number(
      publication.run({ entry: approvedId, user: userId, task: 'new-year-post', url: reelUrl, kind: 'reel', external: 'DPrevNY2026', published: ago(24 * 8 + 2), media: null, checks: allPass, views: 12480, likes: 864, comments: 41, source: 'auto', asked: null, created: ago(24 * 8) }).lastInsertRowid,
    );
    const shot = db.prepare(
      `INSERT INTO snapshots (publication_id, kind, due_at, taken_at, status, views, likes, comments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const plan: Array<[SnapshotKind, number, number | null, number | null, number | null]> = [
      ['submit', 24 * 8, 3210, 240, 12],
      ['h24', 24 * 7, 9150, 701, 33],
      ['d7', 24 * 1, 12480, 864, 41],
      ['d14', -24 * 6, null, null, null],
    ];
    for (const [kind, hoursAgo, views, likes, comments] of plan) {
      const done = views !== null;
      shot.run(reel, kind, ago(hoursAgo), done ? ago(hoursAgo) : null, done ? 'done' : 'pending', views, likes, comments);
    }
    const story = Number(
      publication.run({ entry: reviewId, user: userId, task: 'caravan-shoot', url: storyUrl, kind: 'story', external: '3790000000000000001', published: ago(26.5), media: storyCopy?.path ?? null, checks: JSON.stringify({ ownAccount: 'pass', afterStart: 'unknown', mention: 'pass', hashtag: 'pass', format: 'pass', reachable: 'pass' }), views: null, likes: null, comments: null, source: 'none', asked: ago(2), created: ago(26) }).lastInsertRowid,
    );
    shot.run(story, 'submit', ago(26), ago(26), 'done', null, null, null);
    const coffee = Number(
      publication.run({ entry: changesId, user: userId, task: 'preview-coffee', url: 'https://www.instagram.com/aruzhan.vibes/reel/DPrevCoffee1/', kind: 'reel', external: 'DPrevCoffee1', published: ago(31), media: null, checks: allPass, views: 2140, likes: 188, comments: 9, source: 'auto', asked: null, created: ago(30) }).lastInsertRowid,
    );
    shot.run(coffee, 'submit', ago(30), ago(30), 'done', 1410, 120, 5);
    shot.run(coffee, 'h24', ago(6), ago(6), 'done', 2140, 188, 9);

    // A link from someone else's account, refused: the "This post is from another account" state.
    db.prepare(
      `INSERT INTO submissions (entry_id, user_id, task_id, links, status, result, tries, created_at, claimed_at, finished_at)
       VALUES (?, ?, 'preview-winter-story', ?, 'blocked', ?, 1, ?, ?, ?)`,
    ).run(
      joinedId,
      userId,
      JSON.stringify(['https://www.instagram.com/stories/someone.else/3790000000000000099/']),
      JSON.stringify([{ url: 'https://www.instagram.com/stories/someone.else/3790000000000000099/', author: 'someone.else', expected: 'aruzhan.vibes' }]),
      ago(1),
      ago(1),
      ago(1),
    );

    // Coins, an order, an RSVP.
    const ledger = db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    ledger.run(userId, 15, 'New Year post with Coca-Cola', 'task', String(approvedId), ago(24 * 7));
    ledger.run(userId, 20, 'Welcome bonus from the team', 'bonus', null, ago(24 * 20));
    ledger.run(userId, 25, 'Autumn city walk', 'task', null, ago(24 * 15));
    const order = db
      .prepare(`INSERT INTO orders (user_id, item_id, title, price, size, address, phone, status, created_at) VALUES (?, 'tote-bag', 'Tote bag', 20, NULL, 'Almaty, Dostyk 1, apt 4', '+7 700 000 00 00', 'packed', ?)`)
      .run(userId, ago(24 * 3));
    ledger.run(userId, -20, 'Tote bag', 'order', String(order.lastInsertRowid), ago(24 * 3));
    db.prepare(`INSERT OR IGNORE INTO rsvps (user_id, event_id, code, created_at) VALUES (?, 'creators-ny-party', 'previewpass2026', ?)`).run(userId, ago(24));

    // The paid offer example from the owner's comments.
    db.prepare(
      `INSERT INTO offers (user_id, campaign, fee, need, post_by, answer_by, status, created_at, brief) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(
      userId,
      'New Year with Coca-Cola: hero reel',
      '150,000',
      '1 reel',
      '5 Jan 2027',
      '15 Dec 2026',
      ago(5),
      'The idea\nOne hero reel about your New Year evening with the people you love. Coca-Cola is part of the moment, not an ad break.\n\nMust have\nThe bottle is clearly visible for at least three seconds.\nTag @cocacola_kaz and mark the post as paid partnership.\n\nHow it goes\nYou send us the draft first. We agree the idea on a call, then you post by 5 January.',
    );

    // Other creators, so the leaderboard has company.
    const others: Array<[number, string, string, number]> = [
      [9001, 'Dana', 'dana.almaty', 18400],
      [9002, 'Timur', 'timur.shoots', 15900],
      [9003, 'Aika', 'aika.daily', 9800],
      [9004, 'Miras', 'miras.vlog', 8700],
    ];
    for (const [id, name, handle, views] of others) {
      db.prepare(
        `INSERT OR IGNORE INTO users (id, first_name, instagram, city, onboarded_at, account_status, created_at) VALUES (?, ?, ?, 'Almaty', ?, 'confirmed', ?)`,
      ).run(id, name, handle, ago(24 * 40), ago(24 * 40));
      add({ task: 'new-year-post', status: 'approved', submitted: ago(24 * 6), approved: ago(24 * 5), score: 4, views, reward: 15, delta: 40 }, id);
    }

    db.prepare(`INSERT INTO meta (key, value) VALUES ('preview_seeded', ?)`).run(stamp);
  })();
}
