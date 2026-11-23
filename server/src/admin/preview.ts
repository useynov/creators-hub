// Development preview only (DEV_USER_ID set, never in production): fills a local database with
// a believable state so every admin screen can be looked at in a browser. Runs once per database.
// Telegram ids start at 1000 so they never meet the creator workstream's demo user (id 1).

import { crc32, deflateSync } from 'node:zlib';
import { config } from '../config.js';
import { now, type DB } from '../db.js';
import { saveMedia } from '../media.js';
import { INVITE_LINK_NOTE } from '../service.js';
import { devLoginEnabled } from './auth.js';

const SEEDED = 'admin_preview_seeded';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A small PNG with a soft diagonal gradient: enough to look like a picture, made without any library. */
function gradientPng(width: number, height: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height - 2);
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[offset + i] = Math.round(from[i]! + (to[i]! - from[i]!) * t);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic numbers, so the preview looks the same every time. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE: Array<[[number, number, number], [number, number, number]]> = [
  [[244, 170, 160], [180, 60, 70]],
  [[250, 214, 160], [200, 110, 50]],
  [[170, 210, 200], [40, 110, 110]],
  [[190, 190, 240], [80, 70, 160]],
  [[230, 190, 220], [140, 60, 120]],
  [[200, 220, 170], [80, 120, 50]],
];

const CREATORS: Array<[name: string, handle: string, city: string, tags: string[]]> = [
  ['Aruzhan', 'aruzhan.vibes', 'Almaty', ['еда', 'студенты']],
  ['Sanzhar', 'sanzh.daily', 'Astana', []],
  ['Dana', 'dana.almaty', 'Almaty', ['лайфстайл']],
  ['Timur', 'timur.shoots', 'Almaty', ['видео', 'спорт']],
  ['Aika', 'aika.daily', 'Shymkent', ['мама', 'еда']],
  ['Miras', 'miras.vlog', 'Almaty', ['студенты']],
  ['Zhan', 'zhan.food', 'Almaty', ['еда']],
  ['Aigerim', 'aigerim.style', 'Astana', ['бьюти', 'лайфстайл']],
  ['Nursultan', 'nurs.moves', 'Almaty', ['спорт']],
  ['Kamila', 'kamila.eats', 'Almaty', ['еда']],
  ['Yerlan', 'yerlan.frames', 'Astana', ['видео']],
  ['Madina', 'madi.home', 'Shymkent', ['мама']],
  ['Askar', 'askar.laughs', 'Almaty', ['юмор']],
  ['Zarina', 'zarina.glow', 'Almaty', ['бьюти']],
  ['Bekzat', 'bekzat.run', 'Astana', ['спорт', 'студенты']],
  ['Alina', 'alina.cafe', 'Almaty', ['еда', 'лайфстайл']],
  ['Daniyar', 'dani.travel', 'Almaty', ['лайфстайл']],
  ['Saule', 'saule.kitchen', 'Shymkent', ['еда', 'мама']],
  ['Arman', 'arman.clips', 'Astana', ['юмор', 'видео']],
  ['Togzhan', 'togzhan.day', 'Almaty', ['студенты']],
  ['Ruslan', 'ruslan.drive', 'Almaty', []],
  ['Asel', 'asel.moments', 'Astana', ['лайфстайл']],
  ['Ilyas', 'ilyas.cooks', 'Almaty', ['еда']],
  ['Dilnaz', 'dilnaz.art', 'Almaty', ['видео']],
  ['Olzhas', 'olzhas.fit', 'Shymkent', ['спорт']],
  ['Inkar', 'inkar.reads', 'Almaty', ['студенты']],
  ['Adil', 'adil.street', 'Astana', ['юмор']],
  ['Ayana', 'ayana.makeup', 'Almaty', ['бьюти']],
  ['Yersultan', 'yersultan.cam', 'Almaty', ['видео']],
  ['Meruyert', 'meru.family', 'Shymkent', ['мама']],
];

export async function seedPreview(db: DB): Promise<void> {
  if (!devLoginEnabled() || config.devUserId === null) return;
  if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(SEEDED)) return;
  const rnd = random(2026);
  const at = (ms: number): string => new Date(ms).toISOString();
  const t0 = Date.now();

  // Pictures first (async), the database after, in one transaction.
  const avatars: string[] = [];
  for (let i = 0; i < CREATORS.length; i++) {
    const [from, to] = PALETTE[i % PALETTE.length]!;
    avatars.push((await saveMedia('public', 'avatars', gradientPng(96, 96, from, to))).url!);
  }
  const cover = (await saveMedia('public', 'covers', gradientPng(480, 270, [252, 200, 170], [200, 20, 40]))).url!;
  const storyCopy = (await saveMedia('private', 'stories', gradientPng(180, 320, [40, 30, 30], [220, 10, 23]))).path;
  const screenshot = (await saveMedia('private', 'screens', gradientPng(180, 320, [246, 242, 239], [120, 110, 110]))).path;

  db.transaction(() => {
    const ids = CREATORS.map((_, i) => 1000 + i);
    const statusOf = (i: number): string => (i < 2 || i === 7 || i === 19 || i === 26 ? 'pending' : i === 20 ? 'rejected' : 'confirmed');

    // --- Creators ---------------------------------------------------------
    const user = db.prepare(
      `INSERT OR IGNORE INTO users (id, username, first_name, instagram, tiktok, city, size, address, phone, level, level_override,
         onboarded_at, created_at, birth_date, avatar_url, account_status, account_note, account_reviewed_by, account_reviewed_at)
       VALUES (@id, @username, @name, @instagram, @tiktok, @city, @size, @address, @phone, 'member', @override, @joined, @joined,
         @birth, @avatar, @status, @note, @reviewer, @reviewed)`,
    );
    const profile = db.prepare(
      `INSERT OR IGNORE INTO social_profiles (user_id, platform, handle, full_name, bio, avatar_url, followers, following, posts_count,
         is_private, avg_reel_views, engagement_rate, recent, status, source, fetched_at)
       VALUES (@id, @platform, @handle, @fullName, @bio, @avatar, @followers, @following, @posts, @private, @avg, @er, @recent, @status, 'demo', @fetched)`,
    );
    const tag = db.prepare('INSERT OR IGNORE INTO user_tags (user_id, tag) VALUES (?, ?)');
    const invite = db.prepare('INSERT OR IGNORE INTO invites (telegram_id, username, note, invited_by, created_at) VALUES (?, ?, ?, ?, ?)');

    CREATORS.forEach(([name, handle, city, tags], i) => {
      const id = ids[i]!;
      const followers = Math.round(800 + rnd() * 11_000);
      const avg = Math.round(followers * (0.6 + rnd() * 1.6));
      const joined = t0 - (40 - i) * DAY;
      const status = statusOf(i);
      const recent = Array.from({ length: 6 }, (_, k) => {
        const kind = k % 3 === 2 ? 'post' : 'reel';
        return {
          url: `https://www.instagram.com/${kind === 'reel' ? 'reel' : 'p'}/demo${id}${k}/`,
          kind,
          publishedAt: at(t0 - (k + 1) * 3 * DAY),
          views: kind === 'reel' ? Math.round(avg * (0.6 + rnd() * 0.9)) : null,
          likes: Math.round(followers * (0.03 + rnd() * 0.06)),
          comments: Math.round(5 + rnd() * 40),
          thumbUrl: null,
        };
      });
      user.run({
        id,
        username: handle.replace(/\./g, '_').slice(0, 20),
        name,
        instagram: handle,
        tiktok: i % 4 === 0 ? handle : null,
        city,
        size: ['S', 'M', 'L', 'XL'][i % 4],
        address: i % 3 === 0 ? `Almaty, Abay Ave ${10 + i}, apt ${i + 3}` : null,
        phone: i % 3 === 0 ? `+7 701 555 ${String(1000 + i).slice(-4)}` : null,
        override: [2, 3, 8].includes(i) ? 'pro' : null,
        joined: at(joined),
        birth: `${1996 + (i % 8)}-0${1 + (i % 9)}-1${i % 10}`,
        avatar: avatars[i],
        status,
        note: status === 'rejected' ? 'The profile belongs to a shop, not a person.' : null,
        reviewer: status === 'pending' ? null : 1100,
        reviewed: status === 'pending' ? null : at(joined + DAY),
      });
      profile.run({
        id,
        platform: 'instagram',
        handle,
        fullName: `${name} ✨`,
        bio: `${city}. ${tags.length ? tags.join(', ') : 'life'} and good vibes. Collabs in DM.`,
        avatar: avatars[i],
        followers,
        following: Math.round(200 + rnd() * 700),
        posts: Math.round(60 + rnd() * 400),
        private: i === 6 ? 1 : 0,
        avg,
        er: Math.round((3 + rnd() * 7) * 10) / 10,
        recent: JSON.stringify(recent),
        status: i === 6 ? 'private' : 'ok',
        fetched: at(t0 - (i % 6) * DAY),
      });
      if (i % 4 === 0) {
        profile.run({
          id,
          platform: 'tiktok',
          handle,
          fullName: name,
          bio: null,
          avatar: null,
          followers: Math.round(followers * 0.4),
          following: 120,
          posts: 40,
          private: 0,
          avg: Math.round(avg * 0.7),
          er: 5.2,
          recent: '[]',
          status: 'ok',
          fetched: at(t0 - 2 * DAY),
        });
      }
      for (const t of tags) tag.run(id, t);
      invite.run(id, null, i % 3 === 1 ? INVITE_LINK_NOTE : null, i % 3 === 1 ? null : 1100, at(joined - HOUR));
    });

    // People invited who have not arrived yet, and one who only pressed Start.
    for (const [username, by, days] of [
      ['nurlan_kz', config.devUserId, 5],
      ['gulnara_eats', 1100, 2],
      ['bauyrzhan_tv', null, 1],
    ] as Array<[string, number | null, number]>) {
      db.prepare('INSERT OR IGNORE INTO invites (username, note, invited_by, created_at) VALUES (?, ?, ?, ?)').run(
        username,
        by ? null : INVITE_LINK_NOTE,
        by,
        at(t0 - days * DAY),
      );
    }
    db.prepare(`INSERT OR IGNORE INTO users (id, username, first_name, created_at) VALUES (1050, 'zhanel_k', 'Zhanel', ?)`).run(at(t0 - DAY));
    db.prepare('INSERT OR IGNORE INTO invites (telegram_id, note, created_at) VALUES (1050, ?, ?)').run(INVITE_LINK_NOTE, at(t0 - DAY));

    // --- The team ---------------------------------------------------------
    const member = db.prepare(
      `INSERT OR IGNORE INTO team_members (telegram_id, name, username, role, added_by, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const teamUser = db.prepare(`INSERT OR IGNORE INTO users (id, username, first_name, created_at) VALUES (?, ?, ?, ?)`);
    for (const [id, name, username, role, seen] of [
      [1100, 'Алия', 'aliya_cm', 'manager', 2 * HOUR],
      [1101, 'Ерлан', 'yerlan_cm', 'manager', 26 * HOUR],
      [1102, 'Агентство', 'agency_kz', 'viewer', 3 * DAY],
    ] as Array<[number, string, string, string, number]>) {
      teamUser.run(id, username, name, at(t0 - 30 * DAY));
      member.run(id, name, username, role, config.devUserId, at(t0 - 30 * DAY), at(t0 - seen));
    }
    db.prepare(
      `INSERT INTO team_members (telegram_id, name, role, created_at) VALUES (?, 'Тарлан', 'owner', ?)
       ON CONFLICT(telegram_id) DO UPDATE SET name = 'Тарлан', role = 'owner'`,
    ).run(config.devUserId, at(t0 - 60 * DAY));

    // --- Extra tasks made in the admin ---------------------------------------
    const task = db.prepare(
      `INSERT OR IGNORE INTO tasks (id, title, summary, brief, cover_url, reward, format, formats, required_mention, required_hashtag, place,
         starts_at, deadline, review_mode, views_bonus, bonus_coins, max_publications, max_participants, steps, sort, active, status,
         audience, source, created_by, created_at, updated_at, announced_at)
       VALUES (@id, @title, @summary, @brief, @cover, @reward, @format, @formats, 'cocacola_kz', @hashtag, @place, @starts, @deadline,
         @review, 0, @bonus, 1, @limit, @steps, @sort, 1, @status, @audience, 'admin', @by, @created, @created, @announced)`,
    );
    const steps = JSON.stringify(['Pick your moment.', 'Shoot it your way and post it.', 'Send us the link.']);
    task.run({
      id: 'winter-coffee-break', title: 'Winter coffee break', summary: 'A cosy reel with a Coca-Cola and your favourite café.',
      brief: 'Mood\n\nWarm, slow, cosy. Snow outside, a cold Coca-Cola inside.', cover, reward: 10, format: 'Reel', formats: '["reel"]',
      hashtag: 'winterbreak', place: 'Any café in Almaty', starts: at(t0 + 5 * DAY), deadline: at(t0 + 25 * DAY), review: 'post_first',
      bonus: 50, limit: 20, steps, sort: -3, status: 'draft',
      audience: JSON.stringify({ mode: 'segment', cities: ['Almaty'], tags: ['еда'], followersMin: 1000, followersMax: 10000 }),
      by: config.devUserId, created: at(t0 - DAY), announced: null,
    });
    task.run({
      id: 'autumn-unboxing', title: 'Autumn unboxing', summary: 'Unbox the autumn merch box on camera.', brief: null, cover, reward: 8,
      format: 'Reel or post', formats: '["reel","post"]', hashtag: null, place: null, starts: at(t0 - 40 * DAY),
      deadline: at(t0 - 20 * DAY), review: 'post_first', bonus: null, limit: null, steps, sort: -2, status: 'closed',
      audience: '{"mode":"all"}', by: config.devUserId, created: at(t0 - 41 * DAY), announced: at(t0 - 40 * DAY),
    });
    task.run({
      id: 'students-reel', title: 'Back to campus reel', summary: 'Show your study break with a Coca-Cola.', brief: null, cover, reward: 6,
      format: 'Reel or story', formats: '["reel","story"]', hashtag: 'campusbreak', place: null, starts: at(t0 - 3 * DAY),
      deadline: at(t0 + 12 * DAY), review: 'post_first', bonus: null, limit: 15, steps, sort: -1, status: 'active',
      audience: JSON.stringify({ mode: 'list', userIds: [1005, 1009, 1014, 1019, 1025] }), by: 1100, created: at(t0 - 4 * DAY),
      announced: at(t0 - 3 * DAY),
    });

    // --- Entries, publications and their four measurements --------------------------
    const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?');
    const entry = db.prepare(
      `INSERT OR IGNORE INTO entries (user_id, task_id, status, joined_at, links, note, submitted_at, draft_link, draft_sent_at,
         draft_approved_at, comment, comment_at, score, views, approved_at, reward)
       VALUES (@user, @task, @status, @joined, @links, @note, @submitted, @draft, @draftSent, @draftApproved, @comment, @commentAt,
         @score, @views, @approved, @reward)`,
    );
    const pubInsert = db.prepare(
      `INSERT INTO publications (entry_id, user_id, task_id, url, platform, kind, author_handle, published_at, mentions, hashtags,
         thumb_path, media_path, checks, status, views, likes, comments, views_source, story_views, story_screenshot_path,
         story_asked_at, story_answered_at, created_at, final_at)
       VALUES (@entry, @user, @task, @url, 'instagram', @kind, @author, @published, '[]', '[]', NULL, @media, @checks, @status, @views,
         @likes, @comments, @source, @storyViews, @screenshot, @asked, @answered, @created, @final)`,
    );
    const snap = db.prepare(
      `INSERT OR IGNORE INTO snapshots (publication_id, kind, due_at, taken_at, status, views, likes, comments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ledger = db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const pass = { ownAccount: 'pass', afterStart: 'pass', mention: 'pass', hashtag: 'pass', format: 'pass', reachable: 'pass' };

    interface Work {
      i: number;
      task: string;
      status: string;
      kind?: 'reel' | 'post' | 'story';
      hoursAgo?: number;
      checks?: Record<string, string>;
      removed?: boolean;
      story?: 'stated' | 'waiting' | 'checked';
      score?: number;
      note?: string;
      comment?: string;
      draft?: boolean;
    }
    const works: Work[] = [
      // Waiting for review, with and without flags.
      { i: 0, task: 'caravan-shoot', status: 'in_review', kind: 'reel', hoursAgo: 5, checks: { ...pass, mention: 'fail' }, note: 'Shot at the gate at sunset.' },
      { i: 2, task: 'new-year-post', status: 'in_review', kind: 'reel', hoursAgo: 4 },
      { i: 3, task: 'caravan-shoot', status: 'in_review', kind: 'story', hoursAgo: 3, story: 'waiting' },
      { i: 4, task: 'new-year-post', status: 'in_review', kind: 'post', hoursAgo: 2, checks: { ...pass, afterStart: 'fail' } },
      { i: 5, task: 'caravan-shoot', status: 'in_review', kind: 'reel', hoursAgo: 1 },
      { i: 1, task: 'new-year-post', status: 'in_review', kind: 'reel', hoursAgo: 0.7 },
      { i: 9, task: 'students-reel', status: 'in_review', kind: 'reel', hoursAgo: 0.4, checks: { ...pass, hashtag: 'unknown', reachable: 'unknown' } },
      // Drafts.
      { i: 10, task: 'new-year-table-reel', status: 'draft_review', draft: true, hoursAgo: 6 },
      { i: 11, task: 'new-year-table-reel', status: 'draft_review', draft: true, hoursAgo: 2 },
      { i: 12, task: 'new-year-table-reel', status: 'draft_approved', draft: true, hoursAgo: 30 },
      // Other steps.
      { i: 13, task: 'caravan-shoot', status: 'joined' },
      { i: 14, task: 'new-year-post', status: 'joined' },
      { i: 15, task: 'caravan-shoot', status: 'needs_changes', kind: 'reel', hoursAgo: 20, comment: 'Please add the brand mention in the caption.' },
      // Approved, measured.
      { i: 2, task: 'caravan-shoot', status: 'approved', kind: 'reel', hoursAgo: 16 * 24, score: 5 },
      { i: 3, task: 'new-year-post', status: 'approved', kind: 'reel', hoursAgo: 15 * 24, score: 5 },
      { i: 4, task: 'caravan-shoot', status: 'approved', kind: 'reel', hoursAgo: 8 * 24, score: 4 },
      { i: 9, task: 'new-year-post', status: 'approved', kind: 'post', hoursAgo: 15 * 24, score: 4 },
      { i: 6, task: 'new-year-post', status: 'approved', kind: 'post', hoursAgo: 9 * 24, score: 4 },
      { i: 8, task: 'caravan-shoot', status: 'approved', kind: 'story', hoursAgo: 15 * 24, score: 5, story: 'checked' },
      { i: 16, task: 'caravan-shoot', status: 'approved', kind: 'story', hoursAgo: 3 * 24, score: 4, story: 'stated' },
      { i: 17, task: 'caravan-shoot', status: 'approved', kind: 'story', hoursAgo: 3 * 24, score: 4, story: 'waiting' },
      { i: 5, task: 'new-year-post', status: 'approved', kind: 'reel', hoursAgo: 5 * 24, score: 3, removed: true },
      { i: 18, task: 'caravan-shoot', status: 'approved', kind: 'reel', hoursAgo: 2 * 24, score: 4 },
      { i: 21, task: 'new-year-post', status: 'approved', kind: 'reel', hoursAgo: 26, score: 5 },
      { i: 22, task: 'autumn-unboxing', status: 'approved', kind: 'reel', hoursAgo: 30 * 24, score: 4 },
      { i: 23, task: 'autumn-unboxing', status: 'approved', kind: 'post', hoursAgo: 29 * 24, score: 3 },
      { i: 24, task: 'autumn-unboxing', status: 'approved', kind: 'reel', hoursAgo: 28 * 24, score: 5 },
      { i: 25, task: 'students-reel', status: 'approved', kind: 'reel', hoursAgo: 40, score: 4 },
    ];

    const schedule: Array<[string, number]> = [['submit', 0], ['h24', 24], ['d7', 168], ['d14', 336]];
    for (const work of works) {
      if (!exists.get(work.task)) continue;
      const userId = ids[work.i]!;
      const handle = CREATORS[work.i]![1];
      const created = t0 - (work.hoursAgo ?? 48) * HOUR;
      const url = work.kind ? `https://www.instagram.com/${work.kind === 'story' ? `stories/${handle}/31${userId}` : `${work.kind === 'post' ? 'p' : 'reel'}/C${userId}${work.task.length}x`}/` : null;
      const { reward, title } = db.prepare('SELECT reward, title FROM tasks WHERE id = ?').get(work.task) as { reward: number; title: string };
      const result = entry.run({
        user: userId,
        task: work.task,
        status: work.status,
        joined: at(created - 2 * DAY),
        links: JSON.stringify(url ? [url] : []),
        note: work.note ?? null,
        submitted: url ? at(created) : null,
        draft: work.draft ? `https://drive.google.com/file/d/demo${userId}/view` : null,
        draftSent: work.draft ? at(created) : null,
        draftApproved: work.status === 'draft_approved' ? at(created + 3 * HOUR) : null,
        comment: work.comment ?? null,
        commentAt: work.comment ? at(created + 2 * HOUR) : null,
        score: work.score ?? null,
        views: 0,
        approved: work.status === 'approved' ? at(created + 4 * HOUR) : null,
        reward: work.status === 'approved' ? reward : null,
      });
      if (!result.changes) continue;
      const entryId = Number(result.lastInsertRowid);
      if (work.status === 'approved') ledger.run(userId, reward, title, 'task', String(entryId), at(created + 4 * HOUR));
      if (!url || !work.kind) continue;

      // Views grow quickly in the first day, then slowly.
      const base = Math.round(400 + rnd() * 2000);
      const curve = [1, 3.6, 6.4, 7];
      const age = t0 - created;
      const taken = schedule.filter(([, hours], k) => age >= hours * HOUR && !(work.removed && k >= 2));
      const isPost = work.kind === 'post';
      const isStory = work.kind === 'story';
      const latest = taken.length ? Math.round(base * curve[taken.length - 1]!) : null;
      const storyViews = work.story === 'stated' || work.story === 'checked' ? Math.round(300 + rnd() * 900) : null;
      const pubStatus = work.removed ? 'removed' : taken.length === 4 || (isStory && storyViews !== null) ? 'final' : 'tracking';
      const pub = pubInsert.run({
        entry: entryId,
        user: userId,
        task: work.task,
        url,
        kind: work.kind,
        author: handle,
        published: at(created - 20 * 60 * 1000),
        media: isStory ? storyCopy : null,
        checks: JSON.stringify(work.checks ?? pass),
        status: pubStatus,
        views: isPost || isStory ? null : latest,
        likes: isStory ? null : Math.round(base * 0.08 * Math.max(1, taken.length)),
        comments: isStory ? null : Math.round(4 + rnd() * 30),
        source: isStory ? (storyViews !== null ? 'creator' : 'none') : 'auto',
        storyViews,
        screenshot: storyViews !== null ? screenshot : null,
        asked: isStory && age >= DAY ? at(created + DAY) : null,
        answered: storyViews !== null ? at(created + DAY + 3 * HOUR) : null,
        created: at(created),
        final: pubStatus === 'final' ? at(created + 336 * HOUR) : null,
      });
      const pubId = Number(pub.lastInsertRowid);
      if (work.story === 'checked') {
        db.prepare('UPDATE publications SET story_checked_at = ? WHERE id = ?').run(at(created + 2 * DAY), pubId);
      }
      if (!isStory) {
        schedule.forEach(([kind, hours], k) => {
          const due = created + hours * HOUR;
          const done = k < taken.length;
          const skipped = work.removed && k >= 2;
          snap.run(
            pubId,
            kind,
            at(due),
            done ? at(due + 5 * 60 * 1000) : null,
            skipped ? 'skipped' : done ? 'done' : 'pending',
            done && !isPost ? Math.round(base * curve[k]!) : null,
            done ? Math.round(base * 0.08 * (k + 1)) : null,
            done ? Math.round(4 + k * 6) : null,
          );
        });
      }
      const counted = isStory ? (storyViews ?? 0) : isPost ? 0 : (latest ?? 0);
      db.prepare('UPDATE entries SET views = views + ? WHERE id = ?').run(counted, entryId);
    }

    // --- Shop orders and cash-outs -------------------------------------------
    const order = db.prepare(
      `INSERT INTO orders (user_id, item_id, title, price, size, address, phone, status, created_at, status_at, status_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const orders: Array<[number, string, string, number, string | null, string, number]> = [
      [2, 'hoodie', 'Hoodie', 60, 'S', 'new', 1],
      [3, 't-shirt', 'T-shirt', 30, 'L', 'new', 2],
      [4, 'tote-bag', 'Tote bag', 20, null, 'new', 2],
      [8, 'cinema-tickets', 'Cinema tickets', 40, null, 'packed', 4],
      [16, 't-shirt', 'T-shirt', 30, 'M', 'packed', 5],
      [21, 'hoodie', 'Hoodie', 60, 'M', 'shipped', 7],
      [22, 'tote-bag', 'Tote bag', 20, null, 'delivered', 12],
      [24, 't-shirt', 'T-shirt', 30, 'XL', 'delivered', 14],
    ];
    for (const [i, item, title, price, size, status, days] of orders) {
      const userId = ids[i]!;
      const created = at(t0 - days * DAY);
      const result = order.run(
        userId, item, title, price, size,
        `${['Almaty', 'Astana', 'Shymkent'][i % 3]}, ${['Abay Ave', 'Dostyk St', 'Tole Bi St'][i % 3]} ${20 + i}, apt ${4 + i}`,
        `+7 70${i % 8} 555 ${String(2000 + i).slice(-4)}`,
        status, created, status === 'new' ? null : at(t0 - (days - 1) * DAY), status === 'new' ? null : 1100,
      );
      ledger.run(userId, -price, title, 'order', String(result.lastInsertRowid), created);
    }
    const cashout = db.prepare(
      `INSERT INTO cashouts (user_id, coins, details, status, created_at, decided_at, decided_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [i, coins, status, days] of [
      [2, 120, 'new', 0.3],
      [8, 80, 'new', 1],
      [3, 100, 'paid', 9],
      [2, 100, 'paid', 21],
      [8, 60, 'rejected', 15],
    ] as Array<[number, number, string, number]>) {
      const userId = ids[i]!;
      const created = at(t0 - days * DAY);
      const result = cashout.run(
        userId, coins, `Kaspi Gold, card ending ${String(4400 + i).slice(-4)}`, status, created,
        status === 'new' ? null : at(t0 - (days - 1) * DAY), status === 'new' ? null : config.devUserId,
        status === 'rejected' ? 'The card number did not match the name.' : null,
      );
      const ref = String(result.lastInsertRowid);
      ledger.run(userId, 400, 'Bonus from the team', 'bonus', null, at(t0 - 30 * DAY));
      ledger.run(userId, -coins, 'Cash-out', 'cashout', ref, created);
      if (status === 'rejected') ledger.run(userId, coins, 'Cash-out returned', 'cashout', ref, at(t0 - (days - 1) * DAY));
    }

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(SEEDED, now());
  })();
  console.log('[admin] preview data is ready: open /admin/login and use the development sign-in.');
}
