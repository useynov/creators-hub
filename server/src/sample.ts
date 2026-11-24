// Sample data: twenty made-up creators with work, measurements, orders and payouts, so the
// admin site, the reports and the leaderboard can be looked at before real creators arrive.
//
// Everything here is clearly separable from real data:
//   - sample creators have ids in a reserved block (SAMPLE_ID_FROM..SAMPLE_ID_TO in db.ts) that
//     no Telegram account has; the bot never messages them and the data jobs never read their
//     made-up links (see notify.ts, jobs.ts, pipeline.ts, account.ts);
//   - their handles end in ".sample" and their links contain "SAMPLE";
//   - the two sample tasks are shown only to sample creators (audience by list);
//   - one call removes all of it again, including the pictures.
//
// Owners load and remove it with /sampledata on and /sampledata off in the bot.

import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { gradientPng, random } from './admin/preview.js';
import { config } from './config.js';
import { now, SAMPLE_ID_FROM, SAMPLE_IDS_SQL, type DB } from './db.js';
import { mediaFile, saveMedia } from './media.js';

const META_KEY = 'sample_data';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface SampleMeta {
  loadedAt: string;
  tasks: string[];
  /** Files written for the sample data: [zone, path]. Deleted again on removal. */
  media: Array<['public' | 'private', string]>;
}

export interface SampleStatus {
  loaded: boolean;
  creators: number;
  loadedAt: string | null;
}

type Status = 'confirmed' | 'pending' | 'rejected';

interface SampleCreator {
  name: string;
  handle: string;
  city: string;
  followers: number;
  bio: string;
  tags: string[];
  birth: string;
  status?: Status;
  override?: 'pro' | 'partner';
  private?: boolean;
}

/** Made-up people. First names only, handles that end in ".sample". */
const CREATORS: SampleCreator[] = [
  { name: 'Aigerim', handle: 'aigerim.sample', city: 'Almaty', followers: 18_400, bio: 'Almaty. Food spots, coffee and city walks.', tags: ['food', 'lifestyle'], birth: '1997-03-14', override: 'pro' },
  { name: 'Daniyar', handle: 'daniyar.sample', city: 'Almaty', followers: 42_300, bio: 'Short films about the mountains and the city.', tags: ['video', 'travel'], birth: '1994-08-02', override: 'pro' },
  { name: 'Madina', handle: 'madina.sample', city: 'Astana', followers: 67_900, bio: 'Beauty and everyday looks. Astana.', tags: ['beauty', 'lifestyle'], birth: '1996-11-21', override: 'partner' },
  { name: 'Timur', handle: 'timur.sample', city: 'Almaty', followers: 9_800, bio: 'Street football, sneakers, friends.', tags: ['sport'], birth: '2001-05-09' },
  { name: 'Aruzhan', handle: 'aruzhan.sample', city: 'Almaty', followers: 5_200, bio: 'Student life at KBTU. Study breaks and snacks.', tags: ['students', 'food'], birth: '2004-01-30' },
  { name: 'Sanzhar', handle: 'sanzhar.sample', city: 'Shymkent', followers: 12_700, bio: 'Jokes from Shymkent. Yes, we really talk like that.', tags: ['humor', 'video'], birth: '1999-07-17' },
  { name: 'Kamila', handle: 'kamila.sample', city: 'Almaty', followers: 23_500, bio: 'Home cooking for busy people.', tags: ['food', 'family'], birth: '1993-02-25' },
  { name: 'Yerlan', handle: 'yerlan.sample', city: 'Astana', followers: 7_400, bio: 'Photographer. Light, people, long evenings.', tags: ['video'], birth: '1995-09-12' },
  { name: 'Zarina', handle: 'zarina.sample', city: 'Almaty', followers: 31_200, bio: 'Skin care without the nonsense.', tags: ['beauty'], birth: '1998-12-05' },
  { name: 'Bekzat', handle: 'bekzat.sample', city: 'Karaganda', followers: 4_100, bio: 'Running, cold mornings, good playlists.', tags: ['sport', 'students'], birth: '2002-04-19' },
  { name: 'Alina', handle: 'alina.sample', city: 'Almaty', followers: 15_900, bio: 'Cafes of Almaty, one table at a time.', tags: ['food', 'lifestyle'], birth: '1997-06-08' },
  { name: 'Miras', handle: 'miras.sample', city: 'Almaty', followers: 2_900, bio: 'Vlogs from the dorm.', tags: ['students'], birth: '2005-02-11' },
  { name: 'Saule', handle: 'saule.sample', city: 'Shymkent', followers: 11_300, bio: 'Mum of two. Real life, real kitchen.', tags: ['family', 'food'], birth: '1991-10-03' },
  { name: 'Arman', handle: 'arman.sample', city: 'Astana', followers: 28_600, bio: 'Sketches and reactions. New video every Friday.', tags: ['humor', 'video'], birth: '1996-01-27' },
  { name: 'Togzhan', handle: 'togzhan.sample', city: 'Almaty', followers: 6_700, bio: 'Books, tea and city corners.', tags: ['lifestyle', 'students'], birth: '2003-08-23', status: 'pending' },
  { name: 'Ruslan', handle: 'ruslan.sample', city: 'Almaty', followers: 19_800, bio: 'Cars and road trips across Kazakhstan.', tags: ['travel'], birth: '1992-05-16' },
  { name: 'Asel', handle: 'asel.sample', city: 'Astana', followers: 8_900, bio: 'Small joys of a big city.', tags: ['lifestyle'], birth: '1999-03-07' },
  { name: 'Ilyas', handle: 'ilyas.sample', city: 'Almaty', followers: 3_600, bio: 'Learning to cook on camera.', tags: ['food'], birth: '2000-11-29', status: 'pending' },
  { name: 'Dilnaz', handle: 'dilnaz.sample', city: 'Karaganda', followers: 1_450, bio: 'Drawing, dancing, sometimes both.', tags: ['video'], birth: '2004-09-14', status: 'pending', private: true },
  { name: 'Olzhas', handle: 'olzhas.sample', city: 'Shymkent', followers: 950, bio: 'Sport shop news and discounts.', tags: [], birth: '1990-07-01', status: 'rejected' },
];

type Kind = 'reel' | 'post' | 'story';
type Check = 'pass' | 'fail' | 'unknown';
interface Work {
  /** Index into CREATORS. */
  who: number;
  task: string;
  status: 'joined' | 'in_review' | 'needs_changes' | 'approved' | 'draft_review' | 'draft_approved';
  kind?: Kind;
  /** Hours since the work was sent. */
  ago?: number;
  score?: number;
  /** Stories: 'checked' the team corrected the number, 'stated' the creator gave it, 'waiting' not yet. */
  story?: 'checked' | 'stated' | 'waiting';
  removed?: boolean;
  flags?: Partial<Record<'afterStart' | 'mention' | 'hashtag' | 'format' | 'reachable', Check>>;
  note?: string;
  comment?: string;
}

const AUTUMN = 'sample-autumn-table';
const SNOW = 'sample-first-snow';

const WORKS: Work[] = [
  // The finished task: everything approved, every measurement taken.
  { who: 0, task: AUTUMN, status: 'approved', kind: 'reel', ago: 40 * 24, score: 5 },
  { who: 1, task: AUTUMN, status: 'approved', kind: 'reel', ago: 39 * 24, score: 5 },
  { who: 2, task: AUTUMN, status: 'approved', kind: 'reel', ago: 39 * 24 + 5, score: 5 },
  { who: 3, task: AUTUMN, status: 'approved', kind: 'reel', ago: 38 * 24, score: 4 },
  { who: 4, task: AUTUMN, status: 'approved', kind: 'story', ago: 38 * 24 + 3, score: 4, story: 'stated' },
  { who: 5, task: AUTUMN, status: 'approved', kind: 'reel', ago: 37 * 24, score: 4 },
  { who: 6, task: AUTUMN, status: 'approved', kind: 'post', ago: 36 * 24, score: 5 },
  { who: 7, task: AUTUMN, status: 'approved', kind: 'post', ago: 36 * 24 + 8, score: 3 },
  { who: 8, task: AUTUMN, status: 'approved', kind: 'reel', ago: 35 * 24, score: 5 },
  { who: 9, task: AUTUMN, status: 'approved', kind: 'reel', ago: 34 * 24, score: 3, removed: true },
  { who: 10, task: AUTUMN, status: 'approved', kind: 'story', ago: 33 * 24, score: 4, story: 'checked' },
  { who: 12, task: AUTUMN, status: 'approved', kind: 'story', ago: 32 * 24, score: 4, story: 'stated' },
  { who: 13, task: AUTUMN, status: 'approved', kind: 'reel', ago: 31 * 24, score: 5 },
  { who: 15, task: AUTUMN, status: 'approved', kind: 'reel', ago: 30 * 24, score: 4, flags: { hashtag: 'fail' } },
  // The running task: some measured part of the way, some waiting for the team.
  { who: 1, task: SNOW, status: 'approved', kind: 'reel', ago: 8 * 24, score: 5 },
  { who: 2, task: SNOW, status: 'approved', kind: 'reel', ago: 7 * 24 + 6, score: 5 },
  { who: 8, task: SNOW, status: 'approved', kind: 'reel', ago: 5 * 24, score: 4 },
  { who: 0, task: SNOW, status: 'approved', kind: 'story', ago: 4 * 24, score: 4, story: 'stated' },
  { who: 13, task: SNOW, status: 'approved', kind: 'reel', ago: 2 * 24, score: 4 },
  { who: 6, task: SNOW, status: 'approved', kind: 'story', ago: 30, score: 4, story: 'waiting' },
  { who: 3, task: SNOW, status: 'in_review', kind: 'reel', ago: 7, note: 'Shot on Kok Tobe at sunset.' },
  { who: 14, task: SNOW, status: 'in_review', kind: 'reel', ago: 5, flags: { mention: 'fail' } },
  { who: 10, task: SNOW, status: 'in_review', kind: 'story', ago: 3, story: 'waiting' },
  { who: 16, task: SNOW, status: 'in_review', kind: 'reel', ago: 1, flags: { afterStart: 'fail' } },
  { who: 5, task: SNOW, status: 'needs_changes', kind: 'reel', ago: 20, comment: 'Great mood. Please add the brand mention to the caption and send the link again.' },
  { who: 11, task: SNOW, status: 'joined' },
  { who: 15, task: SNOW, status: 'joined' },
  // Drafts waiting for approval on a real draft-first task, if there is one.
  { who: 4, task: 'new-year-table-reel', status: 'draft_review', ago: 6 },
  { who: 7, task: 'new-year-table-reel', status: 'draft_review', ago: 2 },
  { who: 12, task: 'new-year-table-reel', status: 'draft_approved', ago: 30 },
];

const ORDERS: Array<[who: number, item: string, size: string | null, status: 'new' | 'packed' | 'shipped' | 'delivered', daysAgo: number]> = [
  [0, 'hoodie', 'S', 'new', 1],
  [3, 't-shirt', 'L', 'new', 2],
  [8, 'tote-bag', null, 'packed', 4],
  [5, 't-shirt', 'M', 'shipped', 8],
  [6, 'cinema-tickets', null, 'delivered', 15],
  [13, 'hoodie', 'XL', 'delivered', 20],
];

const CASHOUTS: Array<[who: number, coins: number, status: 'new' | 'paid' | 'rejected', daysAgo: number]> = [
  [1, 120, 'new', 0.5],
  [2, 200, 'new', 1.5],
  [0, 100, 'paid', 12],
  [1, 80, 'rejected', 18],
];

const idOf = (index: number): number => SAMPLE_ID_FROM + index;

export function sampleStatus(db: DB): SampleStatus {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY) as { value: string } | undefined;
  const creators = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${SAMPLE_IDS_SQL('id')}`).get() as { n: number }).n;
  let loadedAt: string | null = null;
  try {
    loadedAt = row ? ((JSON.parse(row.value) as SampleMeta).loadedAt ?? null) : null;
  } catch {
    loadedAt = null;
  }
  return { loaded: creators > 0, creators, loadedAt };
}

/** Removes every trace of the sample data. Safe to call when there is none. Returns how many creators were removed. */
export async function removeSampleData(db: DB): Promise<number> {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY) as { value: string } | undefined;
  let meta: SampleMeta = { loadedAt: '', tasks: [], media: [] };
  try {
    if (row) meta = { ...meta, ...(JSON.parse(row.value) as Partial<SampleMeta>) };
  } catch {
    // A broken note means there is nothing more to learn from it.
  }
  const users = SAMPLE_IDS_SQL('user_id');
  const tasks = (Array.isArray(meta.tasks) ? meta.tasks : []).filter((id) => typeof id === 'string');

  const removed = db.transaction(() => {
    db.prepare(`DELETE FROM snapshots WHERE publication_id IN (SELECT id FROM publications WHERE ${users})`).run();
    db.prepare(`DELETE FROM publications WHERE ${users}`).run();
    db.prepare(`DELETE FROM submissions WHERE ${users}`).run();
    db.prepare(`DELETE FROM entries WHERE ${users}`).run();
    for (const table of ['ledger', 'orders', 'cashouts', 'rsvps', 'reminders', 'offers', 'support_threads', 'user_tags', 'social_profiles', 'social_lookups']) {
      db.prepare(`DELETE FROM ${table} WHERE ${users}`).run();
    }
    db.prepare(`DELETE FROM invites WHERE ${SAMPLE_IDS_SQL('telegram_id')}`).run();
    db.prepare(`DELETE FROM age_refusals WHERE ${SAMPLE_IDS_SQL('telegram_id')}`).run();
    const count = db.prepare(`DELETE FROM users WHERE ${SAMPLE_IDS_SQL('id')}`).run().changes;
    // A sample task goes too, unless a real creator has work on it: then it stays, closed, as an ordinary task.
    for (const id of tasks) {
      const real = db.prepare('SELECT 1 FROM entries WHERE task_id = ? LIMIT 1').get(id);
      if (real) db.prepare(`UPDATE tasks SET status = 'closed', active = 0, audience = '{"mode":"all"}', updated_at = ? WHERE id = ?`).run(now(), id);
      else db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM meta WHERE key = ?').run(META_KEY);
    return count;
  })();

  for (const entry of Array.isArray(meta.media) ? meta.media : []) {
    const file = Array.isArray(entry) && (entry[0] === 'public' || entry[0] === 'private') && typeof entry[1] === 'string' ? mediaFile(entry[0], entry[1]) : null;
    if (file) await unlink(file).catch(() => undefined);
  }
  return removed;
}

/**
 * Loads the sample data, replacing an earlier load so the dates are fresh.
 * `by` is the owner who asked: shown as the one who confirmed the accounts and decided the payouts.
 */
export async function loadSampleData(db: DB, by: number | null = config.adminIds[0] ?? null): Promise<{ creators: number; publications: number; tasks: number }> {
  await removeSampleData(db);
  const rnd = random(20261124);
  const t0 = Date.now();
  const at = (ms: number): string => new Date(ms).toISOString();
  const media: SampleMeta['media'] = [];

  // Pictures first (async), the database after, in one transaction.
  const PALETTE: Array<[[number, number, number], [number, number, number]]> = [
    [[244, 170, 160], [180, 60, 70]],
    [[250, 214, 160], [200, 110, 50]],
    [[170, 210, 200], [40, 110, 110]],
    [[190, 190, 240], [80, 70, 160]],
    [[230, 190, 220], [140, 60, 120]],
    [[200, 220, 170], [80, 120, 50]],
  ];
  const thumbs: string[] = [];
  for (const [from, to] of PALETTE) {
    const saved = await saveMedia('public', 'thumbs', gradientPng(180, 320, from, to));
    media.push(['public', saved.path]);
    thumbs.push(saved.path);
  }
  const storyCopy = await saveMedia('private', 'stories', gradientPng(180, 320, [40, 30, 30], [220, 10, 23]));
  const screenshot = await saveMedia('private', 'screens', gradientPng(180, 320, [246, 242, 239], [120, 110, 110]));
  media.push(['private', storyCopy.path], ['private', screenshot.path]);

  let publications = 0;
  const createdTasks: string[] = [];

  db.transaction(() => {
    // --- Creators ---------------------------------------------------------------------
    const user = db.prepare(
      `INSERT INTO users (id, username, first_name, instagram, tiktok, city, size, address, phone, level, level_override,
         onboarded_at, created_at, birth_date, avatar_url, account_status, account_note, account_reviewed_by, account_reviewed_at)
       VALUES (@id, @username, @name, @instagram, @tiktok, @city, @size, @address, @phone, 'member', @override, @joined, @joined,
         @birth, NULL, @status, @note, @reviewer, @reviewed)`,
    );
    const profile = db.prepare(
      `INSERT INTO social_profiles (user_id, platform, handle, full_name, bio, avatar_url, followers, following, posts_count,
         is_private, avg_reel_views, engagement_rate, recent, status, source, fetched_at)
       VALUES (@id, 'instagram', @handle, @fullName, @bio, NULL, @followers, @following, @posts, @private, @avg, @er, @recent, @status, 'demo', @fetched)`,
    );
    const tag = db.prepare('INSERT OR IGNORE INTO user_tags (user_id, tag) VALUES (?, ?)');
    const invite = db.prepare('INSERT OR IGNORE INTO invites (telegram_id, note, invited_by, created_at) VALUES (?, ?, ?, ?)');
    const STREETS = ['Abay Ave', 'Dostyk Ave', 'Tole Bi St', 'Satpayev St'];

    CREATORS.forEach((creator, i) => {
      const id = idOf(i);
      const joined = t0 - (55 - i * 2) * DAY;
      const status: Status = creator.status ?? 'confirmed';
      const avg = Math.round(creator.followers * (0.5 + rnd() * 1.4));
      const recent = Array.from({ length: 6 }, (_, k) => {
        const kind = k % 3 === 2 ? 'post' : 'reel';
        return {
          url: `https://www.instagram.com/${kind === 'reel' ? 'reel' : 'p'}/SAMPLE${i}f${k}/`,
          kind,
          publishedAt: at(t0 - (k + 1) * 3 * DAY),
          views: kind === 'reel' ? Math.round(avg * (0.6 + rnd() * 0.9)) : null,
          likes: Math.round(creator.followers * (0.02 + rnd() * 0.05)),
          comments: Math.round(5 + rnd() * 60),
          thumbUrl: null,
        };
      });
      user.run({
        id,
        username: `${creator.handle.replace('.sample', '')}_sample`,
        name: creator.name,
        instagram: creator.handle,
        tiktok: i % 5 === 0 ? creator.handle : null,
        city: creator.city,
        size: ['S', 'M', 'L', 'XL'][i % 4],
        address: i % 2 === 0 ? `${creator.city}, ${STREETS[i % STREETS.length]} ${12 + i * 3}, apt ${5 + i}` : null,
        phone: i % 2 === 0 ? `+7 700 000 ${String(1000 + i).slice(-4)}` : null,
        override: creator.override ?? null,
        joined: at(joined),
        birth: creator.birth,
        status,
        note: status === 'rejected' ? 'The profile belongs to a shop, not a person.' : null,
        reviewer: status === 'pending' ? null : by,
        reviewed: status === 'pending' ? null : at(joined + DAY),
      });
      profile.run({
        id,
        handle: creator.handle,
        fullName: creator.name,
        bio: creator.bio,
        followers: creator.followers,
        following: Math.round(180 + rnd() * 900),
        posts: Math.round(60 + rnd() * 500),
        private: creator.private ? 1 : 0,
        avg,
        er: Math.round((2.5 + rnd() * 6.5) * 10) / 10,
        recent: JSON.stringify(recent),
        status: creator.private ? 'private' : 'ok',
        fetched: at(t0 - (i % 5) * DAY - HOUR),
      });
      for (const name of creator.tags) tag.run(id, name);
      invite.run(id, 'Sample data', by, at(joined - HOUR));
    });

    // --- Two sample tasks, visible only to sample creators ------------------------------
    const cover = (db.prepare(`SELECT cover_url FROM tasks WHERE cover_url LIKE '/media/%' ORDER BY sort LIMIT 1`).get() as { cover_url: string } | undefined)?.cover_url ?? null;
    const cover2 = (db.prepare(`SELECT cover_url FROM tasks WHERE cover_url LIKE '/media/%' ORDER BY sort DESC LIMIT 1`).get() as { cover_url: string } | undefined)?.cover_url ?? cover;
    const everySample = JSON.stringify({ mode: 'list', userIds: CREATORS.map((_, i) => idOf(i)) });
    const task = db.prepare(
      `INSERT INTO tasks (id, title, summary, brief, cover_url, reward, format, formats, required_mention, required_hashtag, place,
         starts_at, deadline, review_mode, views_bonus, bonus_coins, max_publications, max_participants, steps, sort, active, status,
         audience, source, created_by, created_at, updated_at, announced_at)
       VALUES (@id, @title, @summary, @brief, @cover, @reward, @format, @formats, 'cocacola_kaz', @hashtag, NULL, @starts, @deadline,
         'post_first', 0, @bonus, 1, NULL, @steps, @sort, @active, @status, @audience, 'admin', @by, @created, @created, @announced)`,
    );
    const steps = JSON.stringify(['Pick your moment.', 'Shoot it your way and post it.', 'Send us the link.']);
    task.run({
      id: AUTUMN,
      title: 'Autumn table with Coca-Cola (sample)',
      summary: 'A dinner with friends or family, with Coca-Cola on the table.',
      brief: 'What it is\nAn autumn dinner at home. Warm light, real food, people you like.\n\nMust have\nCoca-Cola is on the table and clearly visible.\nTag the brand and add the hashtag.',
      cover,
      reward: 8,
      format: 'Reel, post or story',
      formats: '["reel","post","story"]',
      hashtag: 'autumntable',
      starts: at(t0 - 45 * DAY),
      deadline: at(t0 - 28 * DAY),
      bonus: 50,
      steps,
      sort: 90,
      active: 0,
      status: 'closed',
      audience: everySample,
      by,
      created: at(t0 - 47 * DAY),
      announced: at(t0 - 45 * DAY),
    });
    task.run({
      id: SNOW,
      title: 'First snow, first sip (sample)',
      summary: 'Show the first snow in your city with a Coca-Cola in hand.',
      brief: 'What it is\nThe first real snow of the season. A walk, a view, a cold bottle in a warm glove.\n\nMust have\nThe bottle or can is clearly visible.\nTag the brand and add the hashtag.',
      cover: cover2,
      reward: 10,
      format: 'Reel or story',
      formats: '["reel","story"]',
      hashtag: 'firstsnow',
      starts: at(t0 - 10 * DAY),
      deadline: at(t0 + 12 * DAY),
      bonus: 50,
      steps,
      sort: 91,
      active: 1,
      status: 'active',
      audience: everySample,
      by,
      created: at(t0 - 12 * DAY),
      announced: at(t0 - 10 * DAY),
    });
    createdTasks.push(AUTUMN, SNOW);

    // --- Work, publications and their four measurements ----------------------------------
    const taskRow = db.prepare('SELECT reward, title, review_mode FROM tasks WHERE id = ?');
    const entry = db.prepare(
      `INSERT OR IGNORE INTO entries (user_id, task_id, status, joined_at, links, note, submitted_at, draft_link, draft_sent_at,
         draft_approved_at, comment, comment_at, score, views, approved_at, reward)
       VALUES (@user, @task, @status, @joined, @links, @note, @submitted, @draft, @draftSent, @draftApproved, @comment, @commentAt,
         @score, 0, @approved, @reward)`,
    );
    const pubInsert = db.prepare(
      `INSERT INTO publications (entry_id, user_id, task_id, url, platform, kind, author_handle, published_at, mentions, hashtags,
         thumb_path, media_path, checks, status, views, likes, comments, views_source, story_views, story_screenshot_path,
         story_asked_at, story_answered_at, story_checked_at, story_checked_by, created_at, final_at, data_source)
       VALUES (@entry, @user, @task, @url, 'instagram', @kind, @author, @published, @mentions, @hashtags, @thumb, @media, @checks,
         @status, @views, @likes, @comments, @source, @storyViews, @screenshot, @asked, @answered, @checked, @checkedBy, @created,
         @final, 'demo')`,
    );
    const snap = db.prepare(
      `INSERT INTO snapshots (publication_id, kind, due_at, taken_at, status, views, likes, comments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ledger = db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const pass: Record<string, Check> = { ownAccount: 'pass', afterStart: 'pass', mention: 'pass', hashtag: 'pass', format: 'pass', reachable: 'pass' };
    const schedule: Array<[string, number]> = [['submit', 0], ['h24', 24], ['d7', 168], ['d14', 336]];
    // Views grow quickly in the first day, then slowly.
    const curve = [0.18, 0.62, 0.93, 1];

    WORKS.forEach((work, n) => {
      const found = taskRow.get(work.task) as { reward: number; title: string; review_mode: string } | undefined;
      if (!found) return;
      const isDraft = work.status === 'draft_review' || work.status === 'draft_approved';
      if (isDraft && found.review_mode !== 'draft_first') return;
      const creator = CREATORS[work.who]!;
      const userId = idOf(work.who);
      const sent = t0 - (work.ago ?? 48) * HOUR;
      const url = work.kind
        ? `https://www.instagram.com/${work.kind === 'story' ? `stories/${creator.handle}/3100000${n}` : `${work.kind === 'post' ? 'p' : 'reel'}/SAMPLE${n}x${work.who}`}/`
        : null;
      const approvedAt = work.status === 'approved' ? sent + 5 * HOUR : null;
      const result = entry.run({
        user: userId,
        task: work.task,
        status: work.status,
        joined: at(sent - 2 * DAY),
        links: JSON.stringify(url ? [url] : []),
        note: work.note ?? null,
        submitted: url ? at(sent) : null,
        draft: isDraft ? `https://drive.google.com/file/d/SAMPLE${n}/view` : null,
        draftSent: isDraft ? at(sent) : null,
        draftApproved: work.status === 'draft_approved' ? at(sent + 3 * HOUR) : null,
        comment: work.comment ?? null,
        commentAt: work.comment ? at(sent + 2 * HOUR) : null,
        score: work.score ?? null,
        approved: approvedAt ? at(approvedAt) : null,
        reward: approvedAt ? found.reward : null,
      });
      if (!result.changes) return;
      const entryId = Number(result.lastInsertRowid);
      if (approvedAt) ledger.run(userId, found.reward, found.title, 'task', String(entryId), at(approvedAt));
      if (!url || !work.kind) return;

      const age = t0 - sent;
      const isStory = work.kind === 'story';
      const isPost = work.kind === 'post';
      // A reel reaches roughly its author's usual audience; the best ones travel further.
      const total = Math.round(creator.followers * (0.45 + rnd() * 1.5) * (work.score === 5 ? 1.5 : 1));
      const taken = schedule.filter(([, hours], k) => age >= hours * HOUR && !(work.removed && k >= 2)).length;
      const latest = taken ? Math.round(total * curve[taken - 1]!) : null;
      const storyViews = work.story === 'stated' || work.story === 'checked' ? Math.round(creator.followers * (0.08 + rnd() * 0.14)) : null;
      const status = work.removed ? 'removed' : (isStory ? storyViews !== null && age >= 2 * DAY : taken === 4) ? 'final' : 'tracking';
      const checks = { ...pass, ...(work.flags ?? {}) };
      const likes = (k: number): number => Math.round(total * 0.07 * curve[k]!);
      const pub = pubInsert.run({
        entry: entryId,
        user: userId,
        task: work.task,
        url,
        kind: work.kind,
        author: creator.handle,
        published: at(sent - 25 * 60 * 1000),
        mentions: JSON.stringify(checks.mention === 'pass' ? ['cocacola_kaz'] : []),
        hashtags: JSON.stringify(checks.hashtag === 'pass' ? [work.task === AUTUMN ? 'autumntable' : 'firstsnow'] : []),
        thumb: isStory ? null : thumbs[n % thumbs.length],
        media: isStory ? storyCopy.path : null,
        checks: JSON.stringify(checks),
        status,
        views: isStory || isPost ? null : latest,
        likes: isStory || !taken ? null : likes(taken - 1),
        comments: isStory || !taken ? null : Math.round(6 + rnd() * 70),
        source: isStory ? (storyViews !== null ? 'creator' : 'none') : 'auto',
        storyViews,
        screenshot: storyViews !== null ? screenshot.path : null,
        asked: isStory && age >= DAY ? at(sent + DAY) : null,
        answered: storyViews !== null ? at(sent + DAY + 3 * HOUR) : null,
        checked: work.story === 'checked' ? at(sent + 2 * DAY) : null,
        checkedBy: work.story === 'checked' ? by : null,
        created: at(sent),
        final: status === 'final' ? at(sent + (isStory ? 2 * DAY : 336 * HOUR)) : null,
      });
      publications++;
      const pubId = Number(pub.lastInsertRowid);
      if (work.removed) db.prepare('UPDATE publications SET missed_at = ? WHERE id = ?').run(at(sent + 3 * DAY), pubId);
      if (!isStory) {
        schedule.forEach(([kind, hours], k) => {
          const due = sent + hours * HOUR;
          const done = k < taken;
          const skipped = Boolean(work.removed) && k >= 2;
          snap.run(
            pubId,
            kind,
            at(due),
            done ? at(due + 4 * 60 * 1000) : null,
            skipped ? 'skipped' : done ? 'done' : 'pending',
            done && !isPost ? Math.round(total * curve[k]!) : null,
            done ? likes(k) : null,
            done ? Math.round(6 + k * 9 + rnd() * 20) : null,
          );
        });
      }
      const counted = isStory ? (storyViews ?? 0) : isPost ? 0 : (latest ?? 0);
      if (counted) db.prepare('UPDATE entries SET views = ? WHERE id = ?').run(counted, entryId);
    });

    // --- Bonuses, shop orders and cash-outs ----------------------------------------------
    for (const who of [0, 1, 2]) ledger.run(idOf(who), 300, 'Top creator of the month', 'bonus', null, at(t0 - 25 * DAY));
    for (const who of [3, 5, 6, 8, 13]) ledger.run(idOf(who), 60, 'Bonus from the team', 'bonus', null, at(t0 - 26 * DAY));

    const item = db.prepare('SELECT title, price FROM shop_items WHERE id = ?');
    const order = db.prepare(
      `INSERT INTO orders (user_id, item_id, title, price, size, address, phone, status, created_at, status_at, status_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [who, itemId, size, status, days] of ORDERS) {
      const found = item.get(itemId) as { title: string; price: number } | undefined;
      if (!found) continue;
      const creator = CREATORS[who]!;
      const created = at(t0 - days * DAY);
      const result = order.run(
        idOf(who),
        itemId,
        found.title,
        found.price,
        size,
        `${creator.city}, ${STREETS[who % STREETS.length]} ${12 + who * 3}, apt ${5 + who}`,
        `+7 700 000 ${String(1000 + who).slice(-4)}`,
        status,
        created,
        status === 'new' ? null : at(t0 - (days - 1) * DAY),
        status === 'new' ? null : by,
      );
      ledger.run(idOf(who), -found.price, found.title, 'order', String(result.lastInsertRowid), created);
    }

    const cashout = db.prepare(
      `INSERT INTO cashouts (user_id, coins, details, status, created_at, decided_at, decided_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [who, coins, status, days] of CASHOUTS) {
      const created = at(t0 - days * DAY);
      const decided = status === 'new' ? null : at(t0 - (days - 1) * DAY);
      const result = cashout.run(
        idOf(who),
        coins,
        `Kaspi Gold, card ending ${String(4400 + who).slice(-4)}`,
        status,
        created,
        decided,
        status === 'new' ? null : by,
        status === 'rejected' ? 'The card holder name did not match.' : null,
      );
      const ref = String(result.lastInsertRowid);
      ledger.run(idOf(who), -coins, 'Cash-out', 'cashout', ref, created);
      if (status === 'rejected') ledger.run(idOf(who), coins, 'Cash-out returned', 'cashout', ref, decided!);
    }

    // --- Events: who is coming ------------------------------------------------------------
    const events = db.prepare(`SELECT id FROM events WHERE active = 1 AND date IS NOT NULL AND date >= date('now') ORDER BY date`).all() as Array<{ id: string }>;
    const rsvp = db.prepare('INSERT OR IGNORE INTO rsvps (user_id, event_id, code, created_at) VALUES (?, ?, ?, ?)');
    events.forEach((event, e) => {
      CREATORS.forEach((creator, i) => {
        if ((creator.status ?? 'confirmed') !== 'confirmed') return;
        if ((i + e) % (e === 0 ? 2 : 3) === 0 || i < 4) rsvp.run(idOf(i), event.id, randomBytes(8).toString('base64url'), at(t0 - (i + 1) * 3 * HOUR));
      });
    });

    const meta: SampleMeta = { loadedAt: now(), tasks: createdTasks, media };
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META_KEY, JSON.stringify(meta));
  })();

  return { creators: CREATORS.length, publications, tasks: createdTasks.length };
}
