import assert from 'node:assert/strict';
import { test } from 'node:test';

// Config is read from the environment at import time, so set it first.
const TOKEN = '123456:TEST-TOKEN';
process.env.BOT_TOKEN = TOKEN;
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
delete process.env.DEV_USER_ID;

const { signInitData, validateInitData } = await import('./auth.js');
const { openDb, syncContent } = await import('./db.js');
const { createApp } = await import('./http.js');
const { outbox } = await import('./notify.js');
const service = await import('./service.js');
const { settings } = await import('./config.js');

const db = openDb(':memory:');
syncContent(db);
const app = createApp(db, () => 'test_bot');

const creator = { id: 42, first_name: 'Aruzhan', username: 'aruzhan' };
const stranger = { id: 77, first_name: 'Nobody', username: 'nobody' };

async function call<T>(user: typeof creator, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await app.request(path, {
    method,
    headers: { authorization: `tma ${signInitData(user, TOKEN)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: (await response.json()) as T };
}

test('launch data: accepts our signature, rejects tampering and stale data', () => {
  const signed = signInitData(creator, TOKEN);
  assert.equal(validateInitData(signed, TOKEN)?.id, 42);
  assert.equal(validateInitData(signed, 'other:token'), null);
  assert.equal(validateInitData(signed.replace('Aruzhan', 'Mallory'), TOKEN), null);
  const old = signInitData(creator, TOKEN, Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60);
  assert.equal(validateInitData(old, TOKEN), null);
});

test('the API is closed to anyone who is not invited', async () => {
  const noAuth = await app.request('/api/bootstrap');
  assert.equal(noAuth.status, 401);
  const uninvited = await call<{ error: string }>(stranger, 'GET', '/api/bootstrap');
  assert.equal(uninvited.status, 403);
  assert.equal(uninvited.data.error, 'not_invited');
});

test('an invite by @username binds to the account and opens the Hub', async () => {
  assert.equal(service.addInvite(db, '@Aruzhan'), 'added');
  assert.equal(service.addInvite(db, 'aruzhan'), 'exists');
  const boot = await call<import('./types.js').Bootstrap>(creator, 'GET', '/api/bootstrap');
  assert.equal(boot.status, 200);
  assert.equal(boot.data.me.onboarded, false);
  assert.equal(boot.data.me.level, 'member');

  const setup = await call<import('./types.js').Me>(creator, 'POST', '/api/me/setup', {
    instagram: '@aruzhan.vibes',
    city: 'Almaty',
  });
  assert.equal(setup.data.onboarded, true);
  assert.equal(setup.data.instagram, 'aruzhan.vibes');
});

test('post-first task: join, send the link, changes, resend, approve, coins and rating', async () => {
  type Task = import('./types.js').TaskView;
  const joined = await call<Task>(creator, 'POST', '/api/tasks/caravan-shoot/join');
  assert.equal(joined.data.entry?.status, 'joined');

  const bad = await call<{ error: string }>(creator, 'POST', '/api/tasks/caravan-shoot/submit', { links: ['not a link'] });
  assert.equal(bad.status, 400);

  const sent = await call<Task>(creator, 'POST', '/api/tasks/caravan-shoot/submit', {
    links: ['instagram.com/reel/abc'],
    note: 'Shot at the gate',
  });
  assert.equal(sent.data.entry?.status, 'in_review');
  assert.deepEqual(sent.data.entry?.links, ['https://instagram.com/reel/abc']);
  const entryId = sent.data.entry!.id;

  service.requestChanges(db, entryId, 'The truck is hard to see.');
  const changes = await call<Task>(creator, 'GET', '/api/tasks/caravan-shoot');
  assert.equal(changes.data.entry?.status, 'needs_changes');
  assert.equal(changes.data.entry?.comment, 'The truck is hard to see.');

  await call<Task>(creator, 'POST', '/api/tasks/caravan-shoot/submit', { links: ['https://instagram.com/reel/def'] });
  service.approveEntry(db, entryId, 4);
  assert.throws(() => service.approveEntry(db, entryId, 4), /not waiting/);

  const done = await call<Task>(creator, 'GET', '/api/tasks/caravan-shoot');
  assert.equal(done.data.entry?.status, 'approved');
  assert.equal(done.data.entry?.reward, 5);
  assert.equal(done.data.entry?.ratingDelta, settings.rating.perPublication + 4 * settings.rating.perScorePoint);

  const wallet = await call<import('./types.js').WalletView>(creator, 'GET', '/api/wallet');
  assert.equal(wallet.data.balance, 5);
  assert.equal(wallet.data.history[0]?.title, 'Shoot the New Year caravan');

  const toCreator = outbox.filter((message) => message.chatId === creator.id).map((message) => message.html);
  assert.ok(toCreator.some((html) => html.includes('Needs changes')));
  assert.ok(toCreator.some((html) => html.includes('+5 coins are in your wallet')));
});

test('draft-first task: the link is refused until the draft is approved', async () => {
  type Task = import('./types.js').TaskView;
  const early = await call<{ error: string }>(creator, 'POST', '/api/tasks/new-year-table-reel/submit', {
    links: ['https://instagram.com/reel/x'],
  });
  assert.equal(early.data.error, 'wrong_step');

  const draft = await call<Task>(creator, 'POST', '/api/tasks/new-year-table-reel/draft', {
    links: ['https://drive.google.com/file/1'],
  });
  assert.equal(draft.data.entry?.status, 'draft_review');
  service.approveDraft(db, draft.data.entry!.id);

  const posted = await call<Task>(creator, 'POST', '/api/tasks/new-year-table-reel/submit', {
    links: ['https://instagram.com/reel/x'],
  });
  assert.equal(posted.data.entry?.status, 'in_review');
  service.approveEntry(db, posted.data.entry!.id, 5);
});

test('shop: an order spends coins and saves delivery details; no overdraft', async () => {
  const tooDear = await call<{ error: string }>(creator, 'POST', '/api/shop/hoodie/order', {
    size: 'M',
    address: 'Almaty, Dostyk 1',
    phone: '+7 700 000 00 00',
  });
  assert.equal(tooDear.data.error, 'not_enough_coins');

  const order = await call<{ balance: number }>(creator, 'POST', '/api/shop/tote-bag/order', {
    address: 'Almaty, Dostyk 1',
    phone: '+7 700 000 00 00',
  });
  assert.equal(order.data.balance, 0);
  const boot = await call<import('./types.js').Bootstrap>(creator, 'GET', '/api/bootstrap');
  assert.equal(boot.data.me.address, 'Almaty, Dostyk 1');
});

test('events: RSVP gives a pass, the team checks it in once', async () => {
  type Events = import('./types.js').EventsView;
  const going = await call<Events>(creator, 'POST', '/api/events/new-year-caravan/rsvp');
  const pass = going.data.upcoming.find((event) => event.id === 'new-year-caravan');
  assert.ok(pass?.going && pass.code);
  assert.equal(service.checkIn(db, 'nope'), null);
  assert.equal(service.checkIn(db, pass.code!)?.already, false);
  assert.equal(service.checkIn(db, pass.code!)?.already, true);
});

test('levels: views push the rating over the Pro line and unlock cash-out', async () => {
  const entry = db.prepare(`SELECT id FROM entries WHERE user_id = 42 AND task_id = 'caravan-shoot'`).get() as { id: number };
  const locked = await call<{ error: string }>(creator, 'POST', '/api/cashout', { coins: 10, details: 'Kaspi' });
  assert.equal(locked.data.error, 'level_locked');

  service.setViews(db, entry.id, settings.levels.pro * settings.rating.viewsPerPoint);
  const boot = await call<import('./types.js').Bootstrap>(creator, 'GET', '/api/bootstrap');
  assert.equal(boot.data.me.level, 'pro');
  assert.equal(boot.data.me.rank, 1);
  assert.ok(outbox.some((message) => message.chatId === creator.id && message.html.includes('You are now Pro')));

  const board = await call<import('./types.js').LeaderboardView>(creator, 'GET', '/api/leaderboard');
  assert.equal(board.data.top[0]?.handle, '@aruzhan.vibes');
  assert.equal(board.data.me?.rank, 1);
});
