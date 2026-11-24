import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMember, auth, call, cookieFrom, login, now, OWNER_ID, setup, VIEWER_ID } from './harness.test.js';

const { createBot } = await import('../bot.js');
const { setApi } = await import('../notify.js');
const { setDemoMode } = await import('../team.js');
const { sha256 } = auth;

const { db, app } = setup();
addMember(db, VIEWER_ID, 'viewer');

async function tryLogin(token: string, origin = 'http://localhost', ip = '10.0.0.1'): Promise<Response> {
  return app.request(`${origin}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin', 'x-forwarded-for': ip },
    body: JSON.stringify({ token }),
  });
}

test('login link: a valid link signs in once and sets a strict session cookie', async () => {
  const token = auth.issueLoginToken(db, OWNER_ID);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  // Only the hash is stored.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_logins WHERE token_hash = ?').get(token) as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_logins WHERE token_hash = ?').get(sha256(token)) as { n: number }).n, 1);

  const first = await tryLogin(token);
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie')!;
  assert.match(cookie, /^ch_admin=[A-Za-z0-9_-]{43};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=604800/);
  assert.doesNotMatch(cookie, /Secure/, 'plain http is allowed on localhost only');
  const session = cookie.split(';')[0]!.split('=')[1]!;
  assert.ok(db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash = ?').get(sha256(session)), 'the session is stored as a hash');
  assert.equal(db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash = ?').get(session), undefined);

  const again = await tryLogin(token);
  assert.equal(again.status, 401, 'a link opens once');
  assert.equal(again.headers.get('set-cookie'), null);
});

test('login link: on the real domain the cookie is Secure and host-only', async () => {
  const response = await tryLogin(auth.issueLoginToken(db, OWNER_ID), 'https://hub.example');
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-ch_admin=/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/);
});

test('login link: expired, unknown, malformed and wrong-person links are refused alike', async () => {
  const expired = auth.issueLoginToken(db, OWNER_ID, Date.now() - 6 * 60 * 1000);
  const res = await tryLogin(expired);
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, 'login_invalid');

  assert.equal((await tryLogin('A'.repeat(43))).status, 401);
  assert.equal((await tryLogin('short')).status, 401);

  // Someone who is not on the team, even if a token was somehow made for them.
  assert.equal((await tryLogin(auth.issueLoginToken(db, 5555))).status, 401);

  // A member removed after the link was sent.
  addMember(db, 903, 'manager');
  const token = auth.issueLoginToken(db, 903);
  db.prepare('DELETE FROM team_members WHERE telegram_id = 903').run();
  assert.equal((await tryLogin(token)).status, 401);
});

test('login link: a newer link replaces an older unused one', async () => {
  const older = auth.issueLoginToken(db, OWNER_ID);
  const newer = auth.issueLoginToken(db, OWNER_ID);
  assert.equal((await tryLogin(older)).status, 401);
  assert.equal((await tryLogin(newer)).status, 200);
});

test('session: required everywhere, ends on logout, expires, and rolls while used', async () => {
  assert.equal((await call(app, null, 'GET', '/api/admin/me')).status, 401);
  assert.equal((await call(app, 'ch_admin=garbage', 'GET', '/api/admin/me')).status, 401);
  assert.equal((await call(app, `ch_admin=${'B'.repeat(43)}`, 'GET', '/api/admin/me')).status, 401);

  const cookie = await login(app, db, OWNER_ID);
  const me = await call(app, cookie, 'GET', '/api/admin/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'owner');
  assert.equal(me.headers.get('cache-control'), 'no-store');

  // Rolling: a session last seen a while ago is extended and the cookie is sent again.
  const hash = sha256(cookie.split('=')[1]!);
  const soon = new Date(Date.now() + 60_000).toISOString();
  db.prepare('UPDATE admin_sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?').run(soon, new Date(Date.now() - 10 * 60_000).toISOString(), hash);
  const rolled = await call(app, cookie, 'GET', '/api/admin/me');
  assert.equal(rolled.status, 200);
  assert.match(rolled.headers.get('set-cookie') ?? '', /ch_admin=/);
  const expires = (db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').get(hash) as { expires_at: string }).expires_at;
  assert.ok(Date.parse(expires) > Date.now() + 6 * 24 * 60 * 60 * 1000);

  // Expired.
  db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() - 1000).toISOString(), hash);
  assert.equal((await call(app, cookie, 'GET', '/api/admin/me')).status, 401);

  // Rolling never goes past 30 days from the login.
  const old = await login(app, db, OWNER_ID);
  db.prepare('UPDATE admin_sessions SET created_at = ? WHERE token_hash = ?').run(
    new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    sha256(old.split('=')[1]!),
  );
  assert.equal((await call(app, old, 'GET', '/api/admin/me')).status, 401);

  // Logout ends exactly this session.
  const live = await login(app, db, OWNER_ID);
  const other = await login(app, db, OWNER_ID);
  const out = await call(app, live, 'POST', '/api/admin/auth/logout');
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await call(app, live, 'GET', '/api/admin/me')).status, 401);
  assert.equal((await call(app, other, 'GET', '/api/admin/me')).status, 200);
});

test('session: someone taken off the team loses access at the next request', async () => {
  addMember(db, 904, 'manager');
  const cookie = await login(app, db, 904);
  assert.equal((await call(app, cookie, 'GET', '/api/admin/me')).status, 200);
  db.prepare('DELETE FROM team_members WHERE telegram_id = 904').run();
  assert.equal((await call(app, cookie, 'GET', '/api/admin/me')).status, 401);
  assert.equal(db.prepare('SELECT 1 FROM admin_sessions WHERE telegram_id = 904').get(), undefined);
});

test('CSRF: mutations need the header and a JSON or multipart body, from the same site', async () => {
  const cookie = await login(app, db, OWNER_ID);
  const post = (headers: Record<string, string>, body = '{}') =>
    app.request('http://localhost/api/admin/auth/logout', { method: 'POST', headers: { cookie, ...headers }, body });

  const missing = await post({ 'content-type': 'application/json' });
  assert.equal(missing.status, 403);
  assert.equal(((await missing.json()) as { error: string }).error, 'csrf');
  assert.equal((await post({ 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' })).status, 403);
  assert.equal((await post({ 'content-type': 'text/plain', 'x-requested-with': 'creators-hub-admin' })).status, 403);
  assert.equal((await post({ 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'creators-hub-admin' }, 'a=1')).status, 403);
  assert.equal((await post({ 'x-requested-with': 'creators-hub-admin' })).status, 403, 'no content type');
  assert.equal(
    (await post({ 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin', origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await post({ 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin', 'sec-fetch-site': 'cross-site' })).status,
    403,
  );
  // The session survived all of that.
  assert.equal((await call(app, cookie, 'GET', '/api/admin/me')).status, 200);
  // A same-origin request with everything in place goes through.
  assert.equal((await post({ 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' })).status, 200);
  // A JSON body that is not an object is refused.
  const fresh = await login(app, db, OWNER_ID);
  const notObject = await app.request('http://localhost/api/admin/tasks/audience', {
    method: 'POST',
    headers: { cookie: fresh, 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin' },
    body: '"text"',
  });
  assert.equal(notObject.status, 400);
  // The login itself also needs the header.
  const bare = await app.request('http://localhost/api/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: auth.issueLoginToken(db, OWNER_ID) }),
  });
  assert.equal(bare.status, 403);
});

test('login attempts are rate-limited per address', async () => {
  auth.loginLimits.perIp.reset();
  for (let i = 0; i < 10; i++) assert.equal((await tryLogin('x', 'http://localhost', '203.0.113.9')).status, 401);
  assert.equal((await tryLogin(auth.issueLoginToken(db, OWNER_ID), 'http://localhost', '203.0.113.9')).status, 429);
  assert.equal((await tryLogin(auth.issueLoginToken(db, OWNER_ID), 'http://localhost', '203.0.113.10')).status, 200, 'another address is fine');
  auth.loginLimits.perIp.reset();
  auth.loginLimits.global.reset();
});

test('the development login does not exist without DEV_USER_ID', async () => {
  const response = await app.request('http://localhost/api/admin/auth/dev', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'creators-hub-admin' },
    body: '{}',
  });
  assert.notEqual(response.status, 200);
  assert.equal(cookieFrom(response), null);
  const info = await call(app, null, 'GET', '/api/admin/auth/info');
  assert.equal(info.data.devLogin, false);
});

test('admin pages carry strict security headers', async () => {
  const page = await app.request('http://localhost/admin/login?token=abc');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
});

// --- The /admin bot command ----------------------------------------------------

const bot = createBot(db);
const sent: Array<{ method: string; payload: Record<string, any> }> = [];
bot.api.config.use(async (_prev, method, payload) => {
  sent.push({ method, payload: payload as Record<string, any> });
  return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'Hub', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any;
setApi(bot.api);

let updateId = 0;
async function command(from: { id: number; first_name: string }, chat: { id: number; type: 'private' | 'group' }, language = 'en'): Promise<string[]> {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: 0,
      chat: chat.type === 'private' ? { id: chat.id, type: 'private', first_name: from.first_name } : { id: chat.id, type: 'group', title: 'Team' },
      from: { ...from, is_bot: false, language_code: language },
      text: '/admin',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  } as any);
  return sent.filter((call) => call.method === 'sendMessage').map((call) => call.payload.text as string);
}

test('/admin in private gives a team member a one-time link, without a link preview', async () => {
  const [reply] = await command({ id: OWNER_ID, first_name: 'Owner' }, { id: OWNER_ID, type: 'private' });
  const match = /https:\/\/hub\.example\/admin\/login\?token=([A-Za-z0-9_-]{43})/.exec(reply ?? '');
  assert.ok(match, 'the reply holds the login link');
  const message = sent.find((call) => call.method === 'sendMessage')!;
  assert.equal(message.payload.link_preview_options?.is_disabled, true);
  assert.equal((await tryLogin(match[1]!)).status, 200);
  assert.equal((await tryLogin(match[1]!)).status, 401);

  const [ru] = await command({ id: VIEWER_ID, first_name: 'Viewer' }, { id: VIEWER_ID, type: 'private' }, 'ru');
  assert.match(ru ?? '', /Вход в админку/);
});

test('/admin never posts a link in a group, and refuses people outside the team', async () => {
  const group = await command({ id: OWNER_ID, first_name: 'Owner' }, { id: -100, type: 'group' });
  assert.ok(group.every((text) => !text.includes('token=')));
  const stranger = await command({ id: 4242, first_name: 'Stranger' }, { id: 4242, type: 'private' });
  assert.ok(stranger.every((text) => !text.includes('token=')));
  assert.equal(db.prepare('SELECT 1 FROM admin_logins WHERE telegram_id = 4242').get(), undefined);
});

test('demo mode does not open the admin site', async () => {
  db.prepare('INSERT INTO invites (telegram_id, created_at) VALUES (77, ?)').run(now());
  setDemoMode(db, true);
  try {
    const replies = await command({ id: 77, first_name: 'Tester' }, { id: 77, type: 'private' });
    assert.ok(replies.every((text) => !text.includes('token=')), 'no link for a demo tester');
    assert.equal(auth.roleOf(db, 77), null);
    assert.equal((await tryLogin(auth.issueLoginToken(db, 77))).status, 401);
  } finally {
    setDemoMode(db, false);
  }
});
