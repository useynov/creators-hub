// The sample data: it fills every screen and report, never reaches a person or the data
// provider, and comes out again without touching what real creators did.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
const mediaDir = mkdtempSync(join(tmpdir(), 'hub-sample-'));
process.env.MEDIA_DIR = mediaDir;
delete process.env.DEV_USER_ID;
delete process.env.ADMIN_CHAT_ID;

const { openDb, syncContent, now, isSampleId, SAMPLE_ID_FROM } = await import('./db.js');
const { loadSampleData, removeSampleData, sampleStatus } = await import('./sample.js');
const { notifyUser, outbox } = await import('./notify.js');
const { refreshDueProfiles } = await import('./jobs.js');
const { runDueSnapshots, recheckPublication } = await import('./pipeline.js');
const { refreshProfile } = await import('./account.js');
const { setProvider } = await import('./social/index.js');
const service = await import('./service.js');
const { reportRows, reportTasks } = await import('./admin/reports.js');
const { reportWorkbook } = await import('./admin/excel.js');
const { overview } = await import('./admin/overview.js');
const { reviewQueues } = await import('./admin/review.js');
const { creatorCard, listCreators } = await import('./admin/creators.js');
const ExcelJS = (await import('exceljs')).default;

const db = openDb(':memory:');
syncContent(db);

// One real creator with real history: none of it may change.
db.prepare(
  `INSERT INTO users (id, username, first_name, instagram, city, birth_date, onboarded_at, created_at, account_status)
   VALUES (42, 'real_one', 'Real', 'real.one', 'Almaty', '1995-05-05', ?, ?, 'confirmed')`,
).run(now(), now());
db.prepare(`INSERT INTO social_profiles (user_id, platform, handle, followers, status, source, fetched_at) VALUES (42, 'instagram', 'real.one', 5000, 'ok', 'apify', ?)`).run(now());
service.grantCoins(db, 42, 25, 'Welcome');

const files = (): number => {
  const walk = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? walk(join(dir, item.name)) : 1), 0);
  return walk(mediaDir);
};
const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

let providerCalls = 0;
setProvider({
  name: 'apify',
  fetchProfile: async () => {
    providerCalls++;
    return { status: 'not_found', handle: 'x' };
  },
  fetchPost: async () => {
    providerCalls++;
    return { status: 'gone' };
  },
  fetchReels: async () => {
    providerCalls++;
    return [];
  },
});

test('loading: twenty creators with work, measurements, orders, payouts and RSVPs', async () => {
  assert.deepEqual(sampleStatus(db), { loaded: false, creators: 0, loadedAt: null });
  const made = await loadSampleData(db, 900);
  assert.equal(made.creators, 20);
  assert.equal(made.tasks, 2);
  assert.ok(made.publications >= 20);

  const status = sampleStatus(db);
  assert.equal(status.loaded, true);
  assert.equal(status.creators, 20);

  assert.equal(count('SELECT COUNT(*) AS n FROM users'), 21);
  assert.deepEqual(
    db.prepare(`SELECT account_status AS s, COUNT(*) AS n FROM users WHERE id >= ${SAMPLE_ID_FROM} GROUP BY 1 ORDER BY 1`).all(),
    [{ s: 'confirmed', n: 16 }, { s: 'pending', n: 3 }, { s: 'rejected', n: 1 }],
  );
  // Everyone is an adult with a handle that says what it is.
  for (const row of db.prepare(`SELECT id, instagram, birth_date FROM users WHERE id >= ${SAMPLE_ID_FROM}`).all() as Array<{ id: number; instagram: string; birth_date: string }>) {
    assert.ok(isSampleId(row.id));
    assert.match(row.instagram, /\.sample$/);
    assert.ok(row.birth_date <= '2008-01-01');
  }
  // No balance below zero: orders and cash-outs are paid for.
  for (const row of db.prepare(`SELECT id FROM users WHERE id >= ${SAMPLE_ID_FROM}`).all() as Array<{ id: number }>) {
    assert.ok(service.balanceOf(db, row.id) >= 0, `balance of ${row.id}`);
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM orders'), 6);
  assert.equal(count('SELECT COUNT(*) AS n FROM cashouts'), 4);
  assert.ok(count('SELECT COUNT(*) AS n FROM rsvps') >= 10);
  assert.ok(count(`SELECT COUNT(*) AS n FROM snapshots WHERE status = 'done'`) >= 40);
});

test('the admin has something to show on every screen', async () => {
  const list = listCreators(db, { q: null, status: null, city: null, followersMin: null, followersMax: null, level: null, tag: null, sort: 'followers', dir: 'desc' }, { page: 1, pageSize: 50, offset: 0 });
  assert.equal(list.rows.length, 21);
  assert.equal(list.rows.filter((row) => row.sample).length, 20);
  assert.equal(list.rows.find((row) => row.id === 42)?.sample, false);

  const board = overview(db);
  assert.equal(board.sampleCreators, 20);
  assert.ok(board.kpi.views > 100_000);
  assert.ok(board.todo.pendingAccounts >= 3);

  const queues = reviewQueues(db);
  assert.ok(queues.works.length >= 4, 'works wait for review');
  assert.ok(queues.drafts.length >= 2, 'drafts wait for approval');

  // The creator's card leads with what they did for the Hub.
  const card = creatorCard(db, SAMPLE_ID_FROM);
  assert.equal(card.sample, true);
  assert.equal(card.name, 'Aigerim');
  assert.equal(card.details.birthDate, '1997-03-14');
  assert.equal(card.instagramProfile?.bio, 'Almaty. Food spots, coffee and city walks.');
  assert.equal(card.hubPosts.length, 2);
  assert.deepEqual(card.hubPosts.map((post) => post.kind), ['story', 'reel'], 'newest first');
  assert.ok(card.hubPosts[0]!.statedViews! > 0 && card.hubPosts[0]!.views === null, 'a story shows the stated number');
  assert.ok(card.hubPosts[1]!.views! > 0 && card.hubPosts[1]!.thumbUrl!.startsWith('/media/thumbs/'));
  assert.equal(card.hubPosts[1]!.status, 'final');
  assert.equal(creatorCard(db, 42).hubPosts.length, 0);
});

test('the report of the finished task is complete and exports to Excel', async () => {
  const tasks = reportTasks(db);
  const autumn = tasks.find((task) => task.id === 'sample-autumn-table');
  assert.ok(autumn, 'the finished sample task is in the list of reports');

  const { rows, totals } = reportRows(db, 'sample-autumn-table', { kind: 'all', status: 'all', sort: 'final', dir: 'desc' }, true);
  assert.equal(rows.length, 14);
  assert.ok(totals.views > 50_000);
  const reel = rows.find((row) => row.kind === 'reel' && row.status === 'final');
  assert.ok(reel, 'a reel with all four measurements');
  const story = rows.find((row) => row.kind === 'story');
  assert.ok(story, 'a story with a number stated by the creator');
  assert.ok(rows.some((row) => row.status === 'removed'), 'one publication was removed');

  const file = await reportWorkbook('Autumn table', rows, totals, 'en');
  assert.ok(file.length > 5_000);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as unknown as ArrayBuffer);
  const sheet = book.worksheets[0]!;
  assert.ok(sheet.rowCount >= 15, 'a header and a line per publication');
  const text = JSON.stringify(sheet.getSheetValues());
  assert.ok(text.includes('aigerim.sample'));
});

test('nothing is ever sent to a sample creator and nothing about them is read from the provider', async () => {
  outbox.length = 0;
  await notifyUser(SAMPLE_ID_FROM, 'Hello');
  await notifyUser(42, 'Hello');
  assert.deepEqual(outbox.map((message) => message.chatId), [42]);

  // Their profiles are "old" and their measurements "due": the jobs still leave them alone.
  db.prepare(`UPDATE social_profiles SET fetched_at = '2020-01-01T00:00:00.000Z' WHERE user_id >= ${SAMPLE_ID_FROM}`).run();
  providerCalls = 0;
  assert.equal(await refreshDueProfiles(db, undefined, 50), 0);
  const pendingBefore = count(`SELECT COUNT(*) AS n FROM snapshots WHERE status = 'pending'`);
  assert.ok(pendingBefore > 0);
  assert.equal(await runDueSnapshots(db, '2030-01-01T00:00:00.000Z'), 0);
  assert.equal(count(`SELECT COUNT(*) AS n FROM snapshots WHERE status = 'pending'`), pendingBefore, 'nothing was measured, skipped or failed');

  // The admin's "Refresh now" and "Check again" do nothing harmful either.
  const before = db.prepare('SELECT followers, status FROM social_profiles WHERE user_id = ?').get(SAMPLE_ID_FROM);
  await refreshProfile(db, SAMPLE_ID_FROM, 'instagram');
  assert.deepEqual(db.prepare('SELECT followers, status FROM social_profiles WHERE user_id = ?').get(SAMPLE_ID_FROM), before);
  const pub = db.prepare(`SELECT id, status FROM publications WHERE user_id = ? AND status = 'final' LIMIT 1`).get(SAMPLE_ID_FROM) as { id: number; status: string };
  assert.equal((await recheckPublication(db, pub.id)).status, 'final');
  assert.equal(providerCalls, 0);
});

test('a real creator does not see the sample tasks, but does see the sample creators on the leaderboard', () => {
  const visible = JSON.stringify(service.listTasks(db, 42));
  assert.ok(!visible.includes('sample-first-snow'));
  assert.ok(!visible.includes('sample-autumn-table'));
  const board = JSON.stringify(service.leaderboard(db, 42, 'all'));
  assert.ok(board.includes('@madina.sample') && board.includes('@daniyar.sample'));
});

test('an event has its own page data: details, the linked task, and how many are coming', () => {
  const events = service.listEvents(db, 42);
  const caravan = events.upcoming.find((event) => event.id === 'new-year-caravan');
  assert.ok(caravan);
  assert.match(caravan.details ?? '', /^Programme\n18:00/);
  assert.ok(caravan.goingCount >= 5, 'sample creators said they are coming');
  assert.equal(caravan.going, false);
  const party = events.upcoming.find((event) => event.id === 'creators-ny-party');
  assert.ok(party?.details?.includes('Dress code'));

  service.rsvp(db, db.prepare('SELECT * FROM users WHERE id = 42').get() as Parameters<typeof service.rsvp>[1], 'new-year-caravan');
  const after = service.listEvents(db, 42).upcoming.find((event) => event.id === 'new-year-caravan')!;
  assert.equal(after.going, true);
  assert.equal(after.goingCount, caravan.goingCount + 1);
  service.cancelRsvp(db, db.prepare('SELECT * FROM users WHERE id = 42').get() as Parameters<typeof service.rsvp>[1], 'new-year-caravan');
});

test('loading again replaces the data instead of doubling it', async () => {
  const filesBefore = files();
  await loadSampleData(db, 900);
  assert.equal(count(`SELECT COUNT(*) AS n FROM users WHERE id >= ${SAMPLE_ID_FROM}`), 20);
  assert.equal(count('SELECT COUNT(*) AS n FROM orders'), 6);
  assert.equal(count(`SELECT COUNT(*) AS n FROM tasks WHERE id LIKE 'sample-%'`), 2);
  assert.equal(files(), filesBefore, 'old pictures were removed, new ones written');
});

test('removing: every trace goes, the real creator is untouched', async () => {
  // A real creator ends up with work on a sample task (the team opened it to everyone): that task must stay.
  db.prepare(`INSERT INTO entries (user_id, task_id, status, joined_at) VALUES (42, 'sample-first-snow', 'joined', ?)`).run(now());

  assert.equal(await removeSampleData(db), 20);
  assert.deepEqual(sampleStatus(db), { loaded: false, creators: 0, loadedAt: null });
  assert.equal(count('SELECT COUNT(*) AS n FROM users'), 1);
  for (const table of ['publications', 'snapshots', 'orders', 'cashouts', 'rsvps', 'user_tags', 'invites']) {
    assert.equal(count(`SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM social_profiles'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM ledger'), 1);
  assert.equal(service.balanceOf(db, 42), 25);
  assert.equal(files(), 0, 'the sample pictures are deleted');

  assert.equal(count(`SELECT COUNT(*) AS n FROM tasks WHERE id = 'sample-autumn-table'`), 0);
  const kept = db.prepare(`SELECT status, active FROM tasks WHERE id = 'sample-first-snow'`).get() as { status: string; active: number };
  assert.deepEqual(kept, { status: 'closed', active: 0 }, 'a task with real work is kept, closed');
  assert.equal(count('SELECT COUNT(*) AS n FROM entries'), 1);

  assert.equal(await removeSampleData(db), 0, 'removing twice is harmless');
  setProvider(null);
});
