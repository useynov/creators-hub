import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const TOKEN = '123456:TEST-TOKEN';
process.env.BOT_TOKEN = TOKEN;
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
delete process.env.DEV_USER_ID;
delete process.env.APIFY_TOKEN;
const MEDIA = mkdtempSync(join(tmpdir(), 'hub-pipeline-'));
process.env.MEDIA_DIR = MEDIA;

const { signInitData } = await import('./auth.js');
const { openDb, syncContent, now } = await import('./db.js');
const { createApp } = await import('./http.js');
const { outbox } = await import('./notify.js');
const service = await import('./service.js');
const pipeline = await import('./pipeline.js');
const { idle } = await import('./background.js');
const { setProvider } = await import('./social/index.js');
const { demoProvider } = await import('./social/demo.js');
type TaskView = import('./types.js').TaskView;
type StoryView = import('./types.js').StoryView;
type PostData = import('./social/types.js').PostData;
type PostResult = import('./social/types.js').PostResult;
type PublicationRow = import('./db.js').PublicationRow;

const db = openDb(':memory:');
syncContent(db);
const app = createApp(db, () => 'test_bot');

// --- A scripted provider: each link answers what the test says ---------------------
const answers = new Map<string, () => PostResult | Promise<PostResult>>();
setProvider({
  name: 'apify',
  fetchProfile: demoProvider.fetchProfile,
  fetchPost: async (url) => (answers.get(url)?.() ?? { status: 'unsupported' }),
});
const post = (url: string, fields: Partial<PostData> = {}): PostResult => ({
  status: 'ok',
  post: {
    url,
    platform: 'instagram',
    kind: 'reel',
    externalId: 'X',
    authorHandle: 'zhanna.films',
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    caption: 'Winter evening with @cocacola_kz #coke_winter',
    mentions: ['cocacola_kz'],
    hashtags: ['coke_winter'],
    views: 100,
    likes: 10,
    comments: 1,
    shares: null,
    thumbUrl: null,
    mediaUrl: null,
    ...fields,
  },
});
const answer = (url: string, result: PostResult | (() => PostResult | Promise<PostResult>)) =>
  answers.set(url, typeof result === 'function' ? result : () => result);

// Downloads (story copies) come from a fake CDN.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
globalThis.fetch = (async (input: string | URL | Request) =>
  String(input).startsWith('https://cdn.example/') ? new Response(png) : new Response('nope', { status: 404 })) as typeof fetch;

interface Person {
  id: number;
  first_name: string;
}
async function call<T>(user: Person, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await app.request(path, {
    method,
    headers: { authorization: `tma ${signInitData(user, TOKEN)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: (await response.json()) as T };
}
const send = (user: Person, taskId: string, links: string[]) => call<TaskView>(user, 'POST', `/api/tasks/${taskId}/submit`, { links });

function person(id: number, handle: string): Person {
  db.prepare(
    `INSERT INTO users (id, first_name, instagram, city, birth_date, onboarded_at, account_status, created_at) VALUES (?, ?, ?, 'Almaty', '1998-01-01', ?, 'confirmed', ?)`,
  ).run(id, `Creator ${id}`, handle, now(), now());
  db.prepare(
    `INSERT INTO social_profiles (user_id, platform, handle, followers, status, source, fetched_at) VALUES (?, 'instagram', ?, 1000, 'ok', 'demo', ?)`,
  ).run(id, handle, now());
  service.addInvite(db, String(id));
  return { id, first_name: `Creator ${id}` };
}

function task(id: string, fields: Partial<Record<string, unknown>> = {}): void {
  db.prepare(
    `INSERT INTO tasks (id, title, reward, deadline, starts_at, formats, required_mention, required_hashtag, max_publications, status, source)
     VALUES (@id, @title, 10, @deadline, @starts, @formats, @mention, @hashtag, @max, 'active', 'admin')`,
  ).run({
    id,
    title: `Task ${id}`,
    deadline: new Date(Date.now() + 10 * 24 * 3600_000).toISOString(),
    starts: new Date(Date.now() - 24 * 3600_000).toISOString(),
    formats: '["reel","story"]',
    mention: 'cocacola_kz',
    hashtag: null,
    max: 2,
    ...fields,
  });
}

const zhanna = person(701, 'zhanna.films');
const toTeam = () => outbox.filter((message) => message.chatId === 900).map((message) => message.html);
const publicationOf = (url: string) => db.prepare('SELECT * FROM publications WHERE url = ?').get(url) as PublicationRow;
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

test('own account: a link from someone else is refused, nothing reaches the team, and a correct resend goes through', async () => {
  task('t-block');
  const foreign = 'https://www.instagram.com/reel/FOREIGN1/';
  answer(foreign, post(foreign, { authorHandle: 'Someone.Else' }));
  const teamBefore = toTeam().length;

  const refused = await send(zhanna, 't-block', [foreign]);
  assert.equal(refused.status, 200);
  assert.equal(refused.data.submission?.status, 'blocked');
  assert.deepEqual(refused.data.submission?.blocked, [{ url: foreign, author: 'someone.else', expected: 'zhanna.films' }]);
  assert.equal(refused.data.entry?.status, 'joined', 'the work is not in review');
  assert.equal(refused.data.publications.length, 0);
  assert.equal(toTeam().length, teamBefore, 'nothing goes to the team');

  // The address itself can name the author: refused even when the post cannot be read.
  const named = 'https://www.instagram.com/someone.else/p/NAMED/';
  answer(named, { status: 'error', message: 'quota' });
  assert.equal((await send(zhanna, 't-block', [named])).data.submission?.status, 'blocked');

  const own = 'https://www.instagram.com/reel/OWN1/';
  answer(own, post(own));
  const accepted = await send(zhanna, 't-block', [own]);
  assert.equal(accepted.data.entry?.status, 'in_review');
  assert.equal(accepted.data.submission, null, 'a finished check is no longer shown');
  assert.equal(accepted.data.publications[0]!.checks.ownAccount, 'pass');
  assert.match(toTeam().at(-1)!, /✅ Posted from their own account/);
});

test('flags: published early, no mention, no hashtag, wrong format and a dead link go through for the reviewer to judge', async () => {
  task('t-flags', { hashtag: 'coke_winter', formats: '["reel"]', max: 3 });
  const early = 'https://www.instagram.com/reel/EARLY/';
  answer(early, post(early, { publishedAt: '2020-01-01T00:00:00Z', caption: 'Just me', mentions: [], hashtags: [] }));
  const story = 'https://www.instagram.com/stories/zhanna.films/111/';
  answer(story, post(story, { kind: 'story', views: null, caption: null, mentions: [], hashtags: [] }));
  const dead = 'https://www.instagram.com/reel/DEAD/';
  answer(dead, { status: 'gone' });

  const sent = await send(zhanna, 't-flags', [early, story, dead]);
  assert.equal(sent.data.entry?.status, 'in_review');
  const [first, second, third] = sent.data.publications;
  assert.deepEqual(first!.checks, { ownAccount: 'pass', afterStart: 'fail', mention: 'fail', hashtag: 'fail', format: 'pass', reachable: 'pass' });
  assert.deepEqual([second!.checks.format, second!.checks.mention, second!.checks.hashtag], ['fail', 'unknown', 'unknown'], 'a story with no readable stickers is unknown, not failed');
  assert.deepEqual([third!.checks.reachable, third!.checks.ownAccount, third!.checks.mention], ['fail', 'unknown', 'unknown']);

  const message = toTeam().at(-1)!;
  for (const words of ['Published before the task started', 'No @cocacola_kz found', 'No #coke_winter found', 'Format story is not one the task asks for', 'The link does not open', 'Could not see who posted it']) {
    assert.ok(message.includes(words), words);
  }
  assert.equal(service.getUser(db, 701)!.account_status, 'confirmed');
});

test('unreadable links: another site and provider failures are accepted with unknown checks', async () => {
  task('t-unknown');
  const blog = 'https://example.com/my-post';
  const broken = 'https://www.instagram.com/reel/BROKEN/';
  answer(broken, () => Promise.reject(new Error('socket hang up')));
  const sent = await send(zhanna, 't-unknown', [blog, broken]);
  assert.equal(sent.data.entry?.status, 'in_review');
  assert.deepEqual(sent.data.publications.map((item) => [item.status, item.checks.reachable]), [
    ['unreachable', 'unknown'],
    ['tracking', 'unknown'],
  ]);
  assert.match(toTeam().at(-1)!, /Could not read the link, check it by hand/);
});

test('checking takes time: the app sees "checking", a second send waits, the answer comes later', async () => {
  task('t-slow');
  const slow = 'https://www.instagram.com/reel/SLOW/';
  let release: () => void = () => undefined;
  answer(slow, () => new Promise<PostResult>((resolve) => (release = () => resolve(post(slow)))));
  const started = Date.now();
  const first = await send(zhanna, 't-slow', [slow]);
  assert.ok(Date.now() - started < 4000, 'the request does not wait for the provider');
  assert.equal(first.data.submission?.status, 'checking');
  assert.equal(first.data.entry?.status, 'joined');
  const second = await send(zhanna, 't-slow', [slow]);
  assert.deepEqual([second.status, (second.data as unknown as { error: string }).error], [409, 'still_checking']);
  release();
  await idle();
  answer(slow, post(slow));
  assert.equal((await call<TaskView>(zhanna, 'GET', '/api/tasks/t-slow')).data.entry?.status, 'in_review');

  const tooMany = await call<{ error: string }>(zhanna, 'POST', '/api/tasks/t-slow/submit', { links: ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'] });
  assert.equal(tooMany.data.error, 'too_many_links');
});

test('four measurements: at submission, 24 hours, 7 days and the final one at 14 days, with the entry total kept in step', async () => {
  // Only this test's publications are measured here: the earlier ones are covered above.
  db.prepare(`UPDATE snapshots SET status = 'skipped' WHERE status = 'pending'`).run();
  const dana = person(702, 'dana.almaty');
  task('t-numbers');
  const reelA = 'https://www.instagram.com/reel/NUMA/';
  const reelB = 'https://www.instagram.com/reel/NUMB/';
  answer(reelA, post(reelA, { authorHandle: 'dana.almaty', views: 100, likes: 10 }));
  answer(reelB, post(reelB, { authorHandle: 'dana.almaty', views: 50, likes: 5 }));
  const sent = await send(dana, 't-numbers', [reelA, reelB]);
  const entryId = sent.data.entry!.id;
  const views = () => (db.prepare('SELECT views FROM entries WHERE id = ?').get(entryId) as { views: number }).views;
  assert.equal(views(), 150);
  const a = publicationOf(reelA);
  assert.deepEqual(pipeline.snapshotsOf(db, a.id).map((row) => [row.kind, row.status]), [
    ['submit', 'done'],
    ['h24', 'pending'],
    ['d7', 'pending'],
    ['d14', 'pending'],
  ]);
  service.approveEntry(db, entryId, 4);
  const balance = service.balanceOf(db, 702);

  assert.equal(await pipeline.runDueSnapshots(db, hours(1)), 0, 'nothing is due yet');
  answer(reelA, post(reelA, { authorHandle: 'dana.almaty', views: 1000, likes: 80 }));
  answer(reelB, post(reelB, { authorHandle: 'dana.almaty', views: 500, likes: 40 }));
  assert.equal(await pipeline.runDueSnapshots(db, hours(25)), 2);
  assert.equal(await pipeline.runDueSnapshots(db, hours(25)), 0, 'safe to run twice');
  assert.equal(views(), 1500);

  // A provider hiccup on day 7 is retried an hour later.
  answer(reelA, { status: 'error', message: 'quota' });
  answer(reelB, post(reelB, { authorHandle: 'dana.almaty', views: 900 }));
  assert.equal(await pipeline.runDueSnapshots(db, hours(24 * 7 + 1)), 1);
  const retry = pipeline.snapshotsOf(db, a.id).find((row) => row.kind === 'd7')!;
  assert.deepEqual([retry.status, retry.attempts], ['pending', 1]);
  answer(reelA, post(reelA, { authorHandle: 'dana.almaty', views: 3000 }));
  assert.equal(await pipeline.runDueSnapshots(db, hours(24 * 7 + 2.5)), 1);
  assert.equal(views(), 3900);

  answer(reelA, post(reelA, { authorHandle: 'dana.almaty', views: 5000, likes: 300, comments: 12 }));
  answer(reelB, post(reelB, { authorHandle: 'dana.almaty', views: 1200 }));
  assert.equal(await pipeline.runDueSnapshots(db, hours(24 * 14 + 3)), 2);
  const finalA = publicationOf(reelA);
  assert.deepEqual([finalA.status, finalA.views, finalA.likes, finalA.comments, finalA.views_source], ['final', 5000, 300, 12, 'auto']);
  assert.ok(finalA.final_at);
  assert.deepEqual(pipeline.snapshotsOf(db, finalA.id).map((row) => [row.kind, row.views]), [
    ['submit', 100],
    ['h24', 1000],
    ['d7', 3000],
    ['d14', 5000],
  ]);
  assert.equal(views(), 6200, 'the entry carries the final numbers');
  assert.equal(service.balanceOf(db, 702), balance, 'measurements never move coins');
  assert.equal(service.leaderboard(db, 702, 'all').me?.views, 6200);
  assert.equal(await pipeline.runDueSnapshots(db, hours(24 * 30)), 0, 'a final publication is not measured again');
});

test('a publication deleted before the final measurement: marked removed, the team is told once, coins stay', async () => {
  const aika = person(703, 'aika.daily');
  task('t-removed');
  const reel = 'https://www.instagram.com/reel/GONE1/';
  answer(reel, post(reel, { authorHandle: 'aika.daily', views: 700 }));
  const sent = await send(aika, 't-removed', [reel]);
  service.approveEntry(db, sent.data.entry!.id, 5);
  const coins = service.balanceOf(db, 703);

  answer(reel, { status: 'gone' });
  const before = toTeam().length;
  await pipeline.runDueSnapshots(db, hours(25));
  const removed = publicationOf(reel);
  assert.deepEqual([removed.status, removed.removed_at, removed.views], ['removed', null, 700], 'status, not removed_at; the last numbers stand');
  assert.deepEqual(pipeline.snapshotsOf(db, removed.id).map((row) => row.status), ['done', 'failed', 'skipped', 'skipped']);
  assert.equal(toTeam().length, before + 1);
  assert.match(toTeam().at(-1)!, /Publication removed/);
  assert.match(toTeam().at(-1)!, /Coins are not taken back automatically/);
  await pipeline.runDueSnapshots(db, hours(24 * 15));
  assert.equal((await pipeline.recheckPublication(db, removed.id)).status, 'removed');
  assert.equal(toTeam().length, before + 1, 'told once');
  assert.equal(service.balanceOf(db, 703), coins);
});

test('recheck: fresh numbers and checks now, without adding a measurement', async () => {
  const miras = person(704, 'miras.vlog');
  task('t-recheck', { hashtag: 'coke_winter' });
  const reel = 'https://www.instagram.com/reel/RECHECK/';
  answer(reel, post(reel, { authorHandle: 'miras.vlog', hashtags: [], caption: 'no tag yet', views: 10 }));
  await send(miras, 't-recheck', [reel]);
  const first = publicationOf(reel);
  assert.equal(JSON.parse(first.checks).hashtag, 'fail');
  answer(reel, post(reel, { authorHandle: 'miras.vlog', views: 99 }));
  const again = await pipeline.recheckPublication(db, first.id);
  assert.deepEqual([JSON.parse(again.checks).hashtag, again.views], ['pass', 99]);
  assert.equal(pipeline.snapshotsOf(db, first.id).length, 4);
  await assert.rejects(pipeline.recheckPublication(db, 999999), /does not exist/);
});

test('stories: a private copy at submission, the bot asks for the views after 24 hours, reminds once, and the creator answers', async () => {
  // Earlier tests sent a story too: settle it so the counts below are this story's alone.
  db.prepare(`UPDATE publications SET story_answered_at = ? WHERE kind = 'story'`).run(now());
  const timur = person(705, 'timur.shoots');
  const other = person(706, 'other.one');
  task('t-story', { formats: '["story"]' });
  const story = 'https://www.instagram.com/stories/timur.shoots/3790001/';
  answer(story, post(story, { kind: 'story', authorHandle: 'timur.shoots', views: null, likes: null, comments: null, mediaUrl: 'https://cdn.example/story.png' }));
  const sent = await send(timur, 't-story', [story]);
  const entryId = sent.data.entry!.id;
  const row = publicationOf(story);
  assert.match(row.media_path ?? '', /^stories\/[0-9a-f]{24}\.png$/);
  assert.ok(existsSync(join(MEDIA, 'private', row.media_path!)), 'kept in the private zone');
  assert.equal((await app.request(`/media/../private/${row.media_path}`)).status, 404, 'never served by the static route');
  assert.equal((await app.request(`/media/${row.media_path}`)).status, 404);
  assert.match(toTeam().at(-1)!, /Story copy saved/);
  assert.equal(sent.data.publications[0]!.storyViewsOpen, false, 'not before 24 hours');

  // The follow-up measurements do not read a story: it is gone after a day, and that is expected.
  answer(story, { status: 'gone' });
  await pipeline.runDueSnapshots(db, hours(25));
  assert.equal(publicationOf(story).status, 'tracking');
  assert.deepEqual(pipeline.snapshotsOf(db, row.id).map((item) => item.status), ['done', 'skipped', 'pending', 'pending']);

  const toTimur = () => outbox.filter((message) => message.chatId === 705);
  const before = toTimur().length;
  assert.equal(pipeline.askForStoryViews(db, hours(23)), 0);
  assert.equal(pipeline.askForStoryViews(db, hours(25)), 1);
  assert.equal(pipeline.askForStoryViews(db, hours(26)), 0, 'asked once');
  assert.match(toTimur().at(-1)!.html, /How many people saw your story\?/);
  assert.equal(toTimur().at(-1)!.button, `/stories/${row.id}`);
  assert.equal(pipeline.askForStoryViews(db, hours(50)), 1, 'one reminder a day later');
  assert.equal(pipeline.askForStoryViews(db, hours(100)), 0, 'then it stops');
  assert.equal(toTimur().length, before + 2);

  // The screen: someone else's story does not exist for them.
  assert.equal((await call(other, 'GET', `/api/stories/${row.id}`)).status, 404);
  assert.equal((await call(other, 'POST', `/api/stories/${row.id}/views`, { views: 5 })).status, 404);
  const view = await call<StoryView>(timur, 'GET', `/api/stories/${row.id}`);
  assert.deepEqual([view.data.hasCopy, view.data.copyIsImage, view.data.editable, view.data.views], [true, true, true, null]);
  const copy = await app.request(`/api/stories/${row.id}/copy`, { headers: { authorization: `tma ${signInitData(timur, TOKEN)}` } });
  assert.deepEqual([copy.status, copy.headers.get('cache-control')], [200, 'private, no-store']);
  assert.equal((await app.request(`/api/stories/${row.id}/copy`, { headers: { authorization: `tma ${signInitData(other, TOKEN)}` } })).status, 404);

  // Without a screenshot.
  assert.equal((await call<{ error: string }>(timur, 'POST', `/api/stories/${row.id}/views`, { views: 'many' })).data.error, 'bad_views');
  const answered = await call<StoryView>(timur, 'POST', `/api/stories/${row.id}/views`, { views: '1 240' });
  assert.deepEqual([answered.status, answered.data.views, answered.data.hasScreenshot], [200, 1240, false]);
  let stored = publicationOf(story);
  assert.deepEqual([stored.views, stored.story_views, stored.views_source, stored.status], [1240, 1240, 'creator', 'final']);
  assert.deepEqual(pipeline.snapshotsOf(db, row.id).map((item) => item.status), ['done', 'skipped', 'skipped', 'skipped']);
  assert.equal((db.prepare('SELECT views FROM entries WHERE id = ?').get(entryId) as { views: number }).views, 1240);
  assert.match(toTeam().at(-1)!, /1,240<\/b> views, without a screenshot/);

  // With a screenshot (multipart): kept private. A file that is not a picture is refused.
  const form = (bytes: Buffer, views: string) => {
    const data = new FormData();
    data.set('views', views);
    data.set('screenshot', new File([new Uint8Array(bytes)], 'stats.png', { type: 'image/png' }));
    return app.request(`/api/stories/${row.id}/views`, { method: 'POST', body: data, headers: { authorization: `tma ${signInitData(timur, TOKEN)}` } });
  };
  const notPicture = await form(Buffer.from('<script>alert(1)</script> padding padding'), '1300');
  assert.equal(notPicture.status, 400);
  assert.equal(((await notPicture.json()) as { error: string }).error, 'bad_screenshot');
  const withShot = await form(png, '1300');
  assert.equal(withShot.status, 200);
  stored = publicationOf(story);
  assert.match(stored.story_screenshot_path ?? '', /^screens\/[0-9a-f]{24}\.png$/);
  assert.ok(existsSync(join(MEDIA, 'private', stored.story_screenshot_path!)));
  assert.equal(stored.views, 1300);

  // The team corrects the number; the screenshot stays.
  const corrected = pipeline.setStoryViews(db, row.id, 1250, { kind: 'team', id: 900 });
  assert.deepEqual([corrected.views, corrected.story_screenshot_path, corrected.views_source], [1250, stored.story_screenshot_path, 'creator']);
  assert.throws(() => pipeline.setStoryViews(db, row.id, -1, { kind: 'team', id: 900 }), /whole number/);
  assert.throws(() => pipeline.setStoryViews(db, publicationOf('https://www.instagram.com/reel/RECHECK/').id, 5, { kind: 'team', id: 900 }), /Only stories/);

  // Once approved, the creator's number is settled.
  service.approveEntry(db, entryId, 5);
  const closed = await call<{ error: string }>(timur, 'POST', `/api/stories/${row.id}/views`, { views: 99999 });
  assert.equal(closed.data.error, 'story_closed');
});

test('a resend replaces dropped links: they leave the entry and stop being measured', async () => {
  const bota = person(707, 'bota.style');
  task('t-resend');
  const oldLink = 'https://www.instagram.com/reel/OLD/';
  const newLink = 'https://www.instagram.com/reel/NEW/';
  answer(oldLink, post(oldLink, { authorHandle: 'bota.style', views: 300 }));
  answer(newLink, post(newLink, { authorHandle: 'bota.style', views: 40 }));
  const sent = await send(bota, 't-resend', [oldLink]);
  service.requestChanges(db, sent.data.entry!.id, 'Please tag us');
  const resent = await send(bota, 't-resend', [newLink]);
  assert.deepEqual(resent.data.publications.map((item) => item.url), [newLink]);
  const dropped = publicationOf(oldLink);
  assert.ok(dropped.removed_at);
  assert.ok(pipeline.snapshotsOf(db, dropped.id).filter((item) => item.kind !== 'submit').every((item) => item.status === 'skipped'));
  assert.equal(resent.data.entry?.views, 40);
  assert.match(toTeam().at(-1)!, /Resubmitted/);
});

test('an interrupted send is picked up again; after repeated failures it goes in unread', async () => {
  const aruzhan = person(708, 'aru.cam');
  task('t-stale');
  const entry = service.joinTask(db, service.getUser(db, 708)!, 't-stale').entry!;
  const old = new Date(Date.now() - 3600_000).toISOString();
  db.prepare(
    `INSERT INTO submissions (entry_id, user_id, task_id, links, status, tries, created_at, claimed_at) VALUES (?, 708, 't-stale', ?, 'checking', 3, ?, ?)`,
  ).run(entry.id, JSON.stringify(['https://www.instagram.com/reel/STALE/']), old, old);
  assert.equal(await pipeline.resumeStaleSubmissions(db), 1);
  const view = (await call<TaskView>(aruzhan, 'GET', '/api/tasks/t-stale')).data;
  assert.equal(view.entry?.status, 'in_review');
  assert.equal(view.publications[0]!.checks.reachable, 'unknown');
  assert.equal(await pipeline.resumeStaleSubmissions(db), 0);
});
