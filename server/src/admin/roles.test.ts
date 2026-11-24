import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCreator, addMember, call, login, MANAGER_ID, now, OWNER_ID, setup, VIEWER_ID } from './harness.test.js';

const ExcelJS = (await import('exceljs')).default;

const { db, app } = setup();
addMember(db, MANAGER_ID, 'manager');
addMember(db, VIEWER_ID, 'viewer');

// Personal data that must never reach the Viewer.
const SECRETS = ['SECRET-ADDRESS-77', 'SECRET-PHONE-77', '1999-04-13', 'SECRET-CARD-77', 'stories/secret-copy.mp4', 'screens/secret-shot.png'];
addCreator(db, 1001, { address: SECRETS[0], phone: SECRETS[1], birthDate: SECRETS[2] });
db.prepare(`INSERT INTO cashouts (user_id, coins, details, created_at) VALUES (1001, 10, ?, ?)`).run(SECRETS[3], now());
db.prepare(`INSERT INTO orders (user_id, item_id, title, price, address, phone, created_at) VALUES (1001, 'hoodie', 'Hoodie', 5, ?, ?, ?)`).run(
  SECRETS[0],
  SECRETS[1],
  now(),
);
const entry = db
  .prepare(`INSERT INTO entries (user_id, task_id, status, joined_at, links, submitted_at) VALUES (1001, 'caravan-shoot', 'approved', ?, '[]', ?)`)
  .run(now(), now());
db.prepare(
  `INSERT INTO publications (entry_id, user_id, task_id, url, kind, media_path, story_screenshot_path, story_views, views_source, created_at)
   VALUES (?, 1001, 'caravan-shoot', 'https://instagram.com/stories/x/1', 'story', ?, ?, 500, 'creator', ?)`,
).run(entry.lastInsertRowid, SECRETS[4], SECRETS[5], now());

type Role = 'owner' | 'manager' | 'viewer';
const O: Role[] = ['owner'];
const OM: Role[] = ['owner', 'manager'];
const ALL: Role[] = ['owner', 'manager', 'viewer'];

interface Case {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pattern: string;
  path: string;
  body?: unknown;
  roles: Role[];
}

/** Every admin route and who may call it. The test below checks this list covers every registered route. */
const CASES: Case[] = [
  { method: 'GET', pattern: '/me', path: '/me', roles: ALL },
  { method: 'GET', pattern: '/overview', path: '/overview', roles: OM },
  { method: 'GET', pattern: '/creators', path: '/creators', roles: OM },
  { method: 'GET', pattern: '/creators/pick', path: '/creators/pick?q=cre', roles: OM },
  { method: 'GET', pattern: '/options', path: '/options', roles: OM },
  { method: 'GET', pattern: '/creators/:id', path: '/creators/1001', roles: OM },
  { method: 'POST', pattern: '/creators/:id/account', path: '/creators/999999/account', body: { status: 'confirmed' }, roles: OM },
  { method: 'POST', pattern: '/creators/:id/refresh', path: '/creators/999999/refresh', roles: OM },
  { method: 'PUT', pattern: '/creators/:id/tags', path: '/creators/1001/tags', body: { tags: ['food'] }, roles: OM },
  { method: 'PUT', pattern: '/creators/:id/level', path: '/creators/1001/level', body: { level: null }, roles: O },
  { method: 'GET', pattern: '/invites', path: '/invites', roles: OM },
  { method: 'POST', pattern: '/invites', path: '/invites', body: { list: '@someone_new' }, roles: OM },
  { method: 'POST', pattern: '/invites/link', path: '/invites/link', body: { action: 'on' }, roles: OM },
  { method: 'GET', pattern: '/tasks', path: '/tasks', roles: OM },
  { method: 'POST', pattern: '/tasks/audience', path: '/tasks/audience', body: { audience: { mode: 'all' } }, roles: OM },
  { method: 'GET', pattern: '/tasks/:id', path: '/tasks/caravan-shoot', roles: OM },
  { method: 'POST', pattern: '/tasks', path: '/tasks', body: { action: 'save', task: {} }, roles: OM },
  { method: 'PUT', pattern: '/tasks/:id', path: '/tasks/caravan-shoot', body: { action: 'save', task: {} }, roles: OM },
  { method: 'POST', pattern: '/tasks/:id/close', path: '/tasks/no-such-task/close', roles: OM },
  { method: 'POST', pattern: '/uploads/cover', path: '/uploads/cover', roles: OM },
  { method: 'GET', pattern: '/review', path: '/review', roles: OM },
  { method: 'GET', pattern: '/review/entries/:id', path: '/review/entries/999999', roles: OM },
  { method: 'POST', pattern: '/review/entries/:id/approve', path: '/review/entries/999999/approve', body: { score: 5 }, roles: OM },
  { method: 'POST', pattern: '/review/entries/:id/changes', path: '/review/entries/999999/changes', body: { comment: 'Fix it' }, roles: OM },
  { method: 'POST', pattern: '/review/entries/:id/approve-draft', path: '/review/entries/999999/approve-draft', roles: OM },
  { method: 'POST', pattern: '/review/publications/:id/recheck', path: '/review/publications/999999/recheck', roles: OM },
  { method: 'POST', pattern: '/review/stories/:id/views', path: '/review/stories/999999/views', body: { views: 10 }, roles: OM },
  { method: 'POST', pattern: '/review/stories/:id/confirm', path: '/review/stories/999999/confirm', roles: OM },
  { method: 'GET', pattern: '/media/publications/:id/:which{story|screenshot}', path: '/media/publications/1/story', roles: OM },
  { method: 'GET', pattern: '/reports', path: '/reports', roles: ALL },
  { method: 'GET', pattern: '/reports/:id', path: '/reports/caravan-shoot', roles: ALL },
  { method: 'GET', pattern: '/reports/:id/export', path: '/reports/caravan-shoot/export', roles: ALL },
  { method: 'GET', pattern: '/orders', path: '/orders', roles: OM },
  { method: 'POST', pattern: '/orders/:id/advance', path: '/orders/999999/advance', body: { from: 'new' }, roles: OM },
  { method: 'GET', pattern: '/orders/export', path: '/orders/export?status=new', roles: OM },
  { method: 'GET', pattern: '/payouts', path: '/payouts', roles: OM },
  { method: 'POST', pattern: '/payouts/:id/paid', path: '/payouts/999999/paid', roles: O },
  { method: 'POST', pattern: '/payouts/:id/reject', path: '/payouts/999999/reject', body: { note: 'No' }, roles: O },
  { method: 'GET', pattern: '/team', path: '/team', roles: O },
  { method: 'POST', pattern: '/team', path: '/team', body: { ref: '@nobody_here', role: 'viewer' }, roles: O },
  { method: 'PATCH', pattern: '/team/:id', path: '/team/123456', body: { role: 'viewer' }, roles: O },
  { method: 'DELETE', pattern: '/team/:id', path: '/team/123456', roles: O },
];
/** Routes that are open without a session, or tested on their own (logout ends the session). */
const SEPARATE = ['GET /auth/info', 'POST /auth/login', 'POST /auth/logout'];

test('the role matrix covers every admin route', () => {
  const registered = new Set(
    app.routes
      .filter((route) => route.path.startsWith('/api/admin/') && route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path.slice('/api/admin'.length)}`),
  );
  const listed = new Set([...CASES.map((c) => `${c.method} ${c.pattern}`), ...SEPARATE]);
  assert.deepEqual([...registered].filter((route) => !listed.has(route)), [], 'routes without a role test');
  assert.deepEqual([...listed].filter((route) => !registered.has(route)), [], 'tested routes that do not exist');
});

test('role matrix: nobody gets 401, a role outside the list gets 403, the listed roles get through', async () => {
  const cookies: Record<Role, string> = {
    owner: await login(app, db, OWNER_ID),
    manager: await login(app, db, MANAGER_ID),
    viewer: await login(app, db, VIEWER_ID),
  };
  for (const c of CASES) {
    const anonymous = await call(app, null, c.method, `/api/admin${c.path}`, c.body);
    assert.equal(anonymous.status, 401, `${c.method} ${c.path} without a session`);
    for (const role of ['owner', 'manager', 'viewer'] as Role[]) {
      const answer = await call(app, cookies[role], c.method, `/api/admin${c.path}`, c.body);
      if (c.roles.includes(role)) {
        assert.ok(answer.status !== 401 && answer.status !== 403, `${role} may ${c.method} ${c.path} (got ${answer.status})`);
      } else {
        assert.equal(answer.status, 403, `${role} may not ${c.method} ${c.path}`);
        assert.equal((answer.data as { error: string }).error, 'forbidden');
      }
    }
  }
});

test('the Viewer never receives personal data, not even in JSON or Excel', async () => {
  const cookie = await login(app, db, VIEWER_ID);
  for (const c of CASES.filter((c) => c.method === 'GET')) {
    const answer = await call(app, cookie, 'GET', `/api/admin${c.path}`);
    const type = answer.headers.get('content-type') ?? '';
    let text: string;
    if (type.includes('spreadsheetml')) {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(answer.data as ArrayBuffer);
      const cells: string[] = [];
      book.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value)))));
      text = cells.join('\n');
      assert.ok(text.includes('Creator 1001'), 'the report itself is there');
    } else {
      text = JSON.stringify(answer.data);
    }
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${c.path} leaks ${secret} to the Viewer`);
  }
  // The report the Viewer sees links to no creator card.
  const report = await call(app, cookie, 'GET', '/api/admin/reports/caravan-shoot');
  assert.equal(report.status, 200);
  assert.equal(report.data.rows[0].creatorId, null);
  const me = await call(app, cookie, 'GET', '/api/admin/me');
  assert.equal(me.data.counters, null);
});

test('private media: Owner and Manager get the file through the role check, nobody else', async () => {
  const pubId = (db.prepare(`SELECT id FROM publications WHERE kind = 'story'`).get() as { id: number }).id;
  const { saveMedia } = await import('../media.js');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const saved = await saveMedia('private', 'screens', png);
  db.prepare('UPDATE publications SET story_screenshot_path = ? WHERE id = ?').run(saved.path, pubId);

  const manager = await login(app, db, MANAGER_ID);
  const file = await call(app, manager, 'GET', `/api/admin/media/publications/${pubId}/screenshot`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call(app, await login(app, db, VIEWER_ID), 'GET', `/api/admin/media/publications/${pubId}/screenshot`)).status, 403);
  // The public media route never serves the private zone.
  assert.equal((await app.request(`http://localhost/media/../private/${saved.path}`)).status, 404);
  assert.equal((await app.request(`http://localhost/media/${saved.path}`)).status, 404);
});

test('team changes: a new role or removal ends the person’s sessions; fixed owners and oneself are protected', async () => {
  const owner = await login(app, db, OWNER_ID);
  addMember(db, 910, 'manager');
  const theirs = await login(app, db, 910);
  assert.equal((await call(app, theirs, 'GET', '/api/admin/overview')).status, 200);

  const changed = await call(app, owner, 'PATCH', '/api/admin/team/910', { role: 'viewer' });
  assert.equal(changed.status, 200);
  assert.equal((await call(app, theirs, 'GET', '/api/admin/me')).status, 401, 'the old session ended');
  const again = await login(app, db, 910);
  assert.equal((await call(app, again, 'GET', '/api/admin/overview')).status, 403, 'now a Viewer');

  assert.equal((await call(app, owner, 'DELETE', '/api/admin/team/910')).status, 200);
  assert.equal((await call(app, again, 'GET', '/api/admin/me')).status, 401);
  assert.equal(db.prepare('SELECT 1 FROM admin_sessions WHERE telegram_id = 910').get(), undefined);

  assert.equal((await call(app, owner, 'PATCH', `/api/admin/team/${OWNER_ID}`, { role: 'viewer' })).status, 403);
  assert.equal((await call(app, owner, 'DELETE', `/api/admin/team/${OWNER_ID}`)).status, 403);
  addMember(db, 911, 'owner');
  const second = await login(app, db, 911);
  assert.equal((await call(app, second, 'PATCH', '/api/admin/team/911', { role: 'viewer' })).status, 403, 'not your own role');

  // Adding: only someone who has started the bot.
  assert.equal((await call(app, owner, 'POST', '/api/admin/team', { ref: '@nobody_at_all', role: 'manager' })).status, 404);
  db.prepare(`INSERT INTO users (id, username, first_name, created_at) VALUES (912, 'new_helper', 'Helper', ?)`).run(now());
  const added = await call(app, owner, 'POST', '/api/admin/team', { ref: '@new_helper', role: 'manager' });
  assert.equal(added.status, 200);
  assert.ok(added.data.some((row: { telegramId: number; role: string }) => row.telegramId === 912 && row.role === 'manager'));
  assert.equal((await call(app, owner, 'POST', '/api/admin/team', { ref: '912', role: 'viewer' })).status, 409);
  assert.equal((await call(app, owner, 'POST', '/api/admin/team', { ref: '@new_helper', role: 'admin' })).status, 400);

  const log = db.prepare(`SELECT action, target, detail FROM audit_log WHERE action LIKE 'team.%' ORDER BY id`).all() as Array<{ action: string }>;
  assert.deepEqual(log.map((row) => row.action), ['team.role', 'team.remove', 'team.add']);
});
