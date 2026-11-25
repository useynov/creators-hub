import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const TOKEN = '123456:TEST-TOKEN';
process.env.BOT_TOKEN = TOKEN;
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
delete process.env.DEV_USER_ID;
delete process.env.APIFY_TOKEN;
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-entry-'));

const { signInitData } = await import('./auth.js');
const { openDb, syncContent } = await import('./db.js');
const { createApp } = await import('./http.js');
const { outbox } = await import('./notify.js');
const service = await import('./service.js');
const account = await import('./account.js');
const { idle } = await import('./background.js');
const { setProvider } = await import('./social/index.js');
const { demoProvider } = await import('./social/demo.js');
type Me = import('./types.js').Me;
type ConnectView = import('./types.js').ConnectView;
type TaskView = import('./types.js').TaskView;

const db = openDb(':memory:');
syncContent(db);
// These tests are about joining and review, not about opening dates: every seed task is open.
db.prepare('UPDATE tasks SET starts_at = ? WHERE starts_at IS NOT NULL').run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
const app = createApp(db, () => 'test_bot');

interface Person {
  id: number;
  first_name: string;
  username?: string;
}
async function call<T>(user: Person, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await app.request(path, {
    method,
    headers: { authorization: `tma ${signInitData(user, TOKEN)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: (await response.json()) as T };
}

/** A birth date that makes someone `years` old today (in the hub's zone, a day of margin either way). */
function bornYearsAgo(years: number, dayShift = 0): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + dayShift);
  return date.toISOString().slice(0, 10);
}

/** Runs the whole setup for a new creator and returns their Me. */
async function onboard(person: Person, handle: string, city = 'Almaty'): Promise<Me> {
  service.addInvite(db, String(person.id));
  const started = await call<ConnectView>(person, 'POST', '/api/me/connect', { birthDate: '1999-03-01', instagram: handle });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  await idle();
  const confirmed = await call<Me>(person, 'POST', '/api/me/connect/confirm', { city });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  return confirmed.data;
}

test('age gate: under 18 is refused for good, and nothing about the person is kept', async () => {
  const kid = { id: 501, first_name: 'Kid', username: 'kid' };
  service.addInvite(db, '501');
  assert.equal((await call(kid, 'GET', '/api/bootstrap')).status, 200);

  const bad = await call<{ error: string }>(kid, 'POST', '/api/me/connect', { birthDate: '2008-02-30', instagram: 'kid.cam' });
  assert.equal(bad.data.error, 'bad_birth_date', 'a date that does not exist');
  const future = await call<{ error: string }>(kid, 'POST', '/api/me/connect', { birthDate: bornYearsAgo(-1), instagram: 'kid.cam' });
  assert.equal(future.data.error, 'bad_birth_date');

  const young = await call<{ error: string }>(kid, 'POST', '/api/me/connect', { birthDate: bornYearsAgo(18, 2), instagram: 'kid.cam' });
  assert.equal(young.status, 403);
  assert.equal(young.data.error, 'age_refused');

  // Only the fact of the refusal remains: no user row, no birth date, no handle.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 501').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_lookups WHERE user_id = 501').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM age_refusals WHERE telegram_id = 501').get()!.n, 1);

  // Trying again with another date, or anything else, is refused before we store anything.
  const again = await call<{ error: string }>(kid, 'POST', '/api/me/connect', { birthDate: '1990-01-01', instagram: 'kid.cam' });
  assert.equal(again.data.error, 'age_refused');
  const boot = await call<{ error: string }>(kid, 'GET', '/api/bootstrap');
  assert.equal(boot.status, 403);
  assert.equal(boot.data.error, 'age_refused');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 501').get()!.n, 0, 'not even the name comes back');
});

test('age gate: someone who turned 18 today is in, and the birth date is asked once', async () => {
  const adult = { id: 502, first_name: 'Adult' };
  service.addInvite(db, '502');
  const today18 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const birthday = `${Number(today18.slice(0, 4)) - 18}${today18.slice(4)}`;
  const ok = await call<ConnectView>(adult, 'POST', '/api/me/connect', { birthDate: birthday, instagram: 'adult.today' });
  assert.equal(ok.status, 200);
  const boot = await call<{ me: Me }>(adult, 'GET', '/api/bootstrap');
  assert.equal(boot.data.me.hasBirthDate, true);
  // A second lookup does not need the date again.
  assert.equal((await call(adult, 'POST', '/api/me/connect', { instagram: 'adult.today2' })).status, 200);
  await idle();
});

test('connect: found, private, not found, provider error, each with the right screen state', async () => {
  const person = { id: 510, first_name: 'Aigerim' };
  service.addInvite(db, '510');
  const look = async (handle: string): Promise<ConnectView> => {
    const started = await call<ConnectView>(person, 'POST', '/api/me/connect', { birthDate: '1998-01-01', instagram: handle });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    await idle();
    return (await call<ConnectView>(person, 'GET', '/api/me/connect')).data;
  };

  const privateOne = await look('aigerim.private');
  assert.deepEqual([privateOne.status, privateOne.handle, privateOne.profile], ['private', 'aigerim.private', null]);
  assert.equal((await look('aigerim.missing')).status, 'not_found');
  assert.equal((await look('aigerim.error')).status, 'error');
  // Confirming anything but a found profile is refused.
  assert.equal((await call<{ error: string }>(person, 'POST', '/api/me/connect/confirm', { city: 'Almaty' })).data.error, 'lookup_not_ready');

  const found = await look('@Aigerim.Eats');
  assert.equal(found.status, 'found');
  assert.equal(found.profile?.handle, 'aigerim.eats');
  assert.ok((found.profile?.followers ?? 0) > 0);
  assert.equal((await call<{ error: string }>(person, 'POST', '/api/me/connect', { instagram: 'not a handle!' })).data.error, 'bad_handle');

  // While the provider is slow the app sees "searching", and the HTTP answer does not wait for it.
  let release: () => void = () => undefined;
  setProvider({
    ...demoProvider,
    fetchProfile: (platform, handle) => new Promise((resolve) => (release = () => resolve(demoProvider.fetchProfile(platform, handle)))),
  });
  const slow = await call<ConnectView>(person, 'POST', '/api/me/connect', { instagram: 'aigerim.eats' });
  assert.equal(slow.data.status, 'searching');
  release();
  await idle();
  setProvider(null);
  assert.equal((await call<ConnectView>(person, 'GET', '/api/me/connect')).data.status, 'found');

  const me = (await call<Me>(person, 'POST', '/api/me/connect/confirm', { city: 'Astana', tiktok: '@aigerim.tt' })).data;
  assert.deepEqual([me.onboarded, me.instagram, me.tiktok, me.city, me.accountStatus], [true, 'aigerim.eats', 'aigerim.tt', 'Astana', 'pending']);
  const stored = account.profileOf(db, 510)!;
  assert.equal(stored.source, 'demo', 'demo data is marked');
  assert.ok(stored.avg_reel_views !== null && stored.engagement_rate !== null);
  assert.equal((await call<ConnectView>(person, 'GET', '/api/me/connect')).data.status, 'idle', 'the lookup is done with');
});

test('connect: the avatar is copied into the public media zone and the averages come from recent posts', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input).startsWith('https://cdn.example/') ? new Response(png, { status: 200 }) : new Response('no', { status: 404 })) as typeof fetch;
  setProvider({
    name: 'apify',
    fetchPost: demoProvider.fetchPost,
    async fetchProfile(platform, handle) {
      return {
        status: 'ok',
        profile: {
          platform, handle, externalId: '1', fullName: 'Nurlan', bio: null, avatarUrl: 'https://cdn.example/nurlan.png',
          followers: 1000, following: 10, postsCount: 3, isPrivate: false, isVerified: false,
          recent: [
            { url: 'https://www.instagram.com/p/a/', kind: 'reel', publishedAt: '2026-11-03T00:00:00Z', views: 3000, likes: 50, comments: 10, thumbUrl: null },
            { url: 'https://www.instagram.com/p/b/', kind: 'reel', publishedAt: '2026-11-02T00:00:00Z', views: 1000, likes: 30, comments: 0, thumbUrl: null },
            { url: 'https://www.instagram.com/p/c/', kind: 'post', publishedAt: '2026-11-01T00:00:00Z', views: null, likes: 10, comments: 0, thumbUrl: null },
          ],
        },
      };
    },
  });
  try {
    const me = await onboard({ id: 520, first_name: 'Nurlan' }, 'nurlan.runs');
    assert.match(me.avatarUrl ?? '', /^\/media\/avatars\/[0-9a-f]{24}\.png$/);
    const image = await app.request(me.avatarUrl!);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    const profile = account.profileOf(db, 520)!;
    assert.equal(profile.avg_reel_views, 2000, 'reels only');
    assert.equal(profile.engagement_rate, 3.3, '(60 + 30 + 10) / 3 / 1000 = 3.3 %');
    assert.equal(profile.source, 'apify');
  } finally {
    globalThis.fetch = realFetch;
    setProvider(null);
  }
});

test('handles are unique: an account held by another member is refused, a rejected claim frees it', async () => {
  await onboard({ id: 530, first_name: 'First' }, 'shared.handle');
  const second = { id: 531, first_name: 'Second' };
  service.addInvite(db, '531');
  const taken = await call<{ error: string }>(second, 'POST', '/api/me/connect', { birthDate: '1997-07-07', instagram: '@Shared.Handle' });
  assert.equal(taken.status, 409);
  assert.equal(taken.data.error, 'handle_taken');

  account.setAccountStatus(db, 530, 'rejected', 900, 'This is not your account.');
  assert.equal((await call(second, 'POST', '/api/me/connect', { birthDate: '1997-07-07', instagram: 'shared.handle' })).status, 200);
  await idle();
  assert.equal((await call<Me>(second, 'POST', '/api/me/connect/confirm', { city: 'Almaty' })).data.instagram, 'shared.handle');
  // Now the first one cannot take it back.
  assert.equal((await call<{ error: string }>({ id: 530, first_name: 'First' }, 'POST', '/api/me/connect', { instagram: 'shared.handle' })).data.error, 'handle_taken');
});

test('account status: what the creator hears, and what they can do while pending, confirmed or rejected', async () => {
  const person = { id: 540, first_name: 'Madina' };
  await onboard(person, 'madina.cooks');
  const toCreator = () => outbox.filter((message) => message.chatId === 540);

  // Pending: inside the Hub, can take and send work, but the work cannot be approved.
  const before = toCreator().length;
  account.setAccountStatus(db, 540, 'pending', 0);
  assert.equal(toCreator().length, before, 'pending is silent');
  const joined = await call<TaskView>(person, 'POST', '/api/tasks/caravan-shoot/join');
  assert.equal(joined.data.entry?.status, 'joined');
  assert.equal(joined.data.locked, null);
  const sent = await call<TaskView>(person, 'POST', '/api/tasks/caravan-shoot/submit', { links: ['https://www.instagram.com/madina.cooks/p/MAD1/'] });
  assert.equal(sent.data.entry?.status, 'in_review');
  const entryId = sent.data.entry!.id;
  assert.throws(() => service.approveEntry(db, entryId, 5), (error: InstanceType<typeof service.HubError>) => error.code === 'account_not_confirmed');
  assert.equal(service.balanceOf(db, 540), 0);

  // Rejected: told why, with a button to change the handle; tasks are locked.
  account.setAccountStatus(db, 540, 'rejected', 900, 'The profile belongs to <someone> else');
  const rejected = toCreator().at(-1)!;
  assert.match(rejected.html, /could not confirm your account/);
  assert.match(rejected.html, /&lt;someone&gt;/, 'the note is escaped');
  assert.equal(rejected.button, '/profile/instagram');
  const row = service.getUser(db, 540)!;
  assert.deepEqual([row.account_status, row.account_note, row.account_reviewed_by], ['rejected', 'The profile belongs to <someone> else', 900]);
  assert.throws(() => service.approveEntry(db, entryId, 5), /rejected/);
  const locked = await call<TaskView[]>(person, 'GET', '/api/tasks');
  assert.ok(locked.data.every((task) => task.locked));
  const refused = await call<{ error: string }>(person, 'POST', '/api/tasks/new-year-post/join');
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error, 'account_rejected');
  const boot = await call<{ me: Me }>(person, 'GET', '/api/bootstrap');
  assert.equal(boot.data.me.accountNote, 'The profile belongs to <someone> else');

  // Changing the handle sends the account back to pending and tells the team.
  await call(person, 'POST', '/api/me/connect', { instagram: 'madina.real' });
  await idle();
  const changed = await call<Me>(person, 'POST', '/api/me/connect/confirm', {});
  assert.deepEqual([changed.data.instagram, changed.data.accountStatus, changed.data.city], ['madina.real', 'pending', 'Almaty']);
  assert.ok(outbox.some((message) => message.chatId === 900 && message.html.includes('Changed Instagram account to confirm')));

  // Confirmed: told so, and the work is paid on approval.
  account.setAccountStatus(db, 540, 'confirmed', 900);
  assert.match(toCreator().at(-1)!.html, /Your account is confirmed/);
  service.approveEntry(db, entryId, 5);
  assert.equal(service.balanceOf(db, 540), 5);

  // Connecting the same handle again (a refresh) keeps the confirmation.
  await call(person, 'POST', '/api/me/connect', { instagram: 'madina.real' });
  await idle();
  assert.equal((await call<Me>(person, 'POST', '/api/me/connect/confirm', {})).data.accountStatus, 'confirmed');
  assert.throws(() => account.setAccountStatus(db, 99999, 'confirmed', 900), /does not exist/);
});

test('refreshProfile: new numbers, and provider trouble never loses the last good ones', async () => {
  const person = { id: 550, first_name: 'Bota' };
  await onboard(person, 'bota.style');
  const first = account.profileOf(db, 550)!;
  assert.equal((await account.refreshProfile(db, 550))?.followers, first.followers);

  setProvider({ ...demoProvider, fetchProfile: async (_platform, handle) => ({ status: 'private', handle }) });
  const wentPrivate = (await account.refreshProfile(db, 550))!;
  assert.deepEqual([wentPrivate.status, wentPrivate.is_private, wentPrivate.followers], ['private', 1, first.followers]);
  setProvider({ ...demoProvider, fetchProfile: async () => ({ status: 'error', message: 'quota' }) });
  assert.equal((await account.refreshProfile(db, 550))!.status, 'error');
  setProvider({ ...demoProvider, fetchProfile: async () => Promise.reject(new Error('boom')) });
  assert.equal((await account.refreshProfile(db, 550))!.status, 'error', 'never throws');
  setProvider(null);
  assert.equal((await account.refreshProfile(db, 550))!.status, 'ok');
  assert.equal(await account.refreshProfile(db, 550, 'tiktok'), null, 'no TikTok handle: nothing to read');

  // TikTok stays optional, and a bad one is refused with a clear message.
  assert.equal((await call<{ error: string }>(person, 'PATCH', '/api/me', { tiktok: 'bad handle!' })).data.error, 'bad_handle');
  assert.equal((await call<Me>(person, 'PATCH', '/api/me', { tiktok: '@bota.tt', instagram: 'hijack' })).data.instagram, 'bota.style', 'the handle only changes through the connect flow');
});

test('a member from v1 (no birth date, no pulled profile) goes through the setup again and keeps everything', async () => {
  const veteran = { id: 560, first_name: 'Askar' };
  service.addInvite(db, '560');
  db.prepare(
    `INSERT INTO users (id, first_name, instagram, city, onboarded_at, account_status, created_at)
     VALUES (560, 'Askar', 'askar.v1', 'Shymkent', '2026-06-01T00:00:00.000Z', 'pending', '2026-06-01T00:00:00.000Z')`,
  ).run();
  db.prepare(`INSERT INTO entries (user_id, task_id, status, joined_at, links, views, approved_at, reward, score) VALUES (560, 'caravan-shoot', 'approved', '2026-06-02T00:00:00Z', '["https://www.instagram.com/p/OLD/"]', 900, '2026-06-03T00:00:00Z', 5, 4)`).run();
  service.grantCoins(db, 560, 25, 'Summer bonus');

  // Not set up: sent to the setup, and nothing else is open.
  const boot = await call<{ me: Me }>(veteran, 'GET', '/api/bootstrap');
  assert.deepEqual([boot.data.me.onboarded, boot.data.me.hasBirthDate, boot.data.me.instagram, boot.data.me.city], [false, false, 'askar.v1', 'Shymkent']);
  const tasks = await call<{ error: string }>(veteran, 'GET', '/api/tasks');
  assert.deepEqual([tasks.status, tasks.data.error], [403, 'setup_required']);
  const join = await call<{ error: string }>(veteran, 'POST', '/api/tasks/new-year-post/join');
  assert.equal(join.data.error, 'setup_required');
  assert.equal(service.announceTask(db, 'new-year-post') >= 0, true);
  assert.ok(!outbox.some((message) => message.chatId === 560 && message.html.includes('New task')), 'not announced to until set up');

  // A weekly refresh does not create the profile behind their back.
  assert.equal(await account.refreshProfile(db, 560), null);
  assert.equal(account.profileOf(db, 560), undefined);

  // The age question and "this is me" with the same handle; the city they had is kept.
  await call(veteran, 'POST', '/api/me/connect', { birthDate: '1995-09-09', instagram: 'askar.v1' });
  await idle();
  const done = await call<Me>(veteran, 'POST', '/api/me/connect/confirm', {});
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual([done.data.onboarded, done.data.city, done.data.instagram, done.data.accountStatus], [true, 'Shymkent', 'askar.v1', 'pending']);
  assert.ok(outbox.some((message) => message.chatId === 900 && message.html.includes('New account to confirm') && message.html.includes('askar.v1')));

  // History, coins and entries are all still there, and the Hub is open again.
  assert.equal(done.data.balance, 25);
  assert.equal(done.data.stats.publications, 1);
  const mine = await call<TaskView>(veteran, 'GET', '/api/tasks/caravan-shoot');
  assert.deepEqual([mine.status, mine.data.entry?.status, mine.data.entry?.views], [200, 'approved', 900]);
  assert.equal((await call<TaskView>(veteran, 'POST', '/api/tasks/new-year-post/join')).data.entry?.status, 'joined');
});

test('brand assets: only photo, font and logo names are served, and a missing file is a plain 404', async () => {
  for (const name of ['no-such-photo.webp', 'no-such-font.woff2', 'no-such-logo.svg']) {
    assert.equal((await app.request(`/brand/${name}`)).status, 404, name);
  }
  // Anything else never reaches the folder: it falls through to the app.
  for (const path of ['/brand/..%2Fseed.json', '/brand/settings.json', '/brand/notes.txt']) {
    const other = await app.request(path);
    assert.ok(!/^(image|font)\//.test(other.headers.get('content-type') ?? ''), path);
  }
});

test('brand assets: an empty file is a broken copy and answers 404, so the app falls back', async () => {
  const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { config } = await import('./config.js');
  mkdirSync(config.brandDir, { recursive: true });
  const empty = join(config.brandDir, 'empty-copy-test.svg');
  const full = join(config.brandDir, 'full-copy-test.svg');
  writeFileSync(empty, '');
  writeFileSync(full, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  try {
    assert.equal((await app.request('/brand/empty-copy-test.svg')).status, 404);
    const served = await app.request('/brand/full-copy-test.svg');
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/svg+xml');
  } finally {
    rmSync(empty, { force: true });
    rmSync(full, { force: true });
  }
});
