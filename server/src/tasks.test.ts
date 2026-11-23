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
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-tasks-'));

const { signInitData } = await import('./auth.js');
const { openDb, syncContent, now } = await import('./db.js');
const { createApp } = await import('./http.js');
const { outbox } = await import('./notify.js');
const service = await import('./service.js');
const account = await import('./account.js');
type TaskView = import('./types.js').TaskView;

const db = openDb(':memory:');
syncContent(db);
const app = createApp(db, () => 'test_bot');

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

/** A creator straight in the database: invited, onboarded, confirmed, with a follower count. */
function creator(id: number, city: string, followers: number, tags: string[] = []): Person {
  db.prepare(
    `INSERT INTO users (id, first_name, instagram, city, birth_date, onboarded_at, account_status, created_at) VALUES (?, ?, ?, ?, '1998-01-01', ?, 'confirmed', ?)`,
  ).run(id, `Creator ${id}`, `creator${id}`, city, now(), now());
  db.prepare(
    `INSERT INTO social_profiles (user_id, platform, handle, followers, status, source, fetched_at) VALUES (?, 'instagram', ?, ?, 'ok', 'demo', ?)`,
  ).run(id, `creator${id}`, followers, now());
  account.setTags(db, id, tags);
  service.addInvite(db, String(id));
  return { id, first_name: `Creator ${id}` };
}

function task(id: string, fields: Partial<Record<string, unknown>> = {}): void {
  const row = {
    title: `Task ${id}`,
    reward: 10,
    deadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    status: 'active',
    active: 1,
    audience: '{"mode":"all"}',
    max_participants: null,
    ...fields,
  };
  db.prepare(
    `INSERT INTO tasks (id, title, reward, deadline, status, active, audience, max_participants, source)
     VALUES (@id, @title, @reward, @deadline, @status, @active, @audience, @max_participants, 'admin')`,
  ).run({ id, ...row });
}

const almatyBig = creator(601, 'Almaty', 20_000, ['food']);
const almatySmall = creator(602, 'Almaty', 900);
const astana = creator(603, 'Astana', 20_000, ['Food']);
const ids = (list: TaskView[]): string[] => list.map((item) => item.id).sort();

test('audience: a segment task is listed, opened and joined only by creators who fit it', async () => {
  task('almaty-only', { audience: JSON.stringify({ mode: 'segment', cities: ['almaty'], followersMin: 5000 }) });
  task('food-tag', { audience: JSON.stringify({ mode: 'segment', tags: ['food'] }) });
  task('hand-picked', { audience: JSON.stringify({ mode: 'list', userIds: [603] }) });

  assert.ok(ids((await call<TaskView[]>(almatyBig, 'GET', '/api/tasks')).data).includes('almaty-only'));
  assert.ok(!ids((await call<TaskView[]>(almatySmall, 'GET', '/api/tasks')).data).includes('almaty-only'), 'too few followers');
  assert.ok(!ids((await call<TaskView[]>(astana, 'GET', '/api/tasks')).data).includes('almaty-only'), 'another city');
  assert.ok(ids((await call<TaskView[]>(astana, 'GET', '/api/tasks')).data).includes('food-tag'), 'tags ignore case');
  assert.ok(!ids((await call<TaskView[]>(almatySmall, 'GET', '/api/tasks')).data).includes('food-tag'));
  assert.ok(ids((await call<TaskView[]>(astana, 'GET', '/api/tasks')).data).includes('hand-picked'));
  assert.ok(!ids((await call<TaskView[]>(almatyBig, 'GET', '/api/tasks')).data).includes('hand-picked'));

  // Opening by link and joining follow the same rule: a hidden task looks like a missing one.
  const opened = await call<{ error: string }>(almatySmall, 'GET', '/api/tasks/almaty-only');
  assert.deepEqual([opened.status, opened.data.error], [404, 'task_not_found']);
  const joined = await call<{ error: string }>(almatySmall, 'POST', '/api/tasks/almaty-only/join');
  assert.deepEqual([joined.status, joined.data.error], [404, 'task_not_found']);
  const sneaky = await call<{ error: string }>(almatySmall, 'POST', '/api/tasks/almaty-only/submit', { links: ['https://www.instagram.com/p/X/'] });
  assert.equal(sneaky.status, 404, 'sending a link is joining too');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE task_id = 'almaty-only'`).get()!.n, 0);

  const ok = await call<TaskView>(almatyBig, 'POST', '/api/tasks/almaty-only/join');
  assert.equal(ok.data.entry?.status, 'joined');

  // Once in, the creator keeps seeing the task even if the audience changes later.
  db.prepare(`UPDATE tasks SET audience = '{"mode":"list","userIds":[]}' WHERE id = 'almaty-only'`).run();
  assert.equal((await call<TaskView>(almatyBig, 'GET', '/api/tasks/almaty-only')).status, 200);
});

test('visibility: drafts, closed and past-deadline tasks are hidden unless the creator took part', async () => {
  task('draft-task', { status: 'draft' });
  task('closed-task', { status: 'closed' });
  task('old-task', { deadline: '2020-01-01T00:00:00Z' });
  task('hidden-task', { active: 0 });
  const listed = ids((await call<TaskView[]>(almatySmall, 'GET', '/api/tasks')).data);
  for (const id of ['draft-task', 'closed-task', 'old-task', 'hidden-task']) {
    assert.ok(!listed.includes(id), id);
    assert.equal((await call(almatySmall, 'GET', `/api/tasks/${id}`)).status, 404, id);
    assert.equal((await call(almatySmall, 'POST', `/api/tasks/${id}/join`)).status, 404, id);
  }
  // Someone who took part before the task closed still sees it, as closed.
  db.prepare(`INSERT INTO entries (user_id, task_id, status, joined_at) VALUES (602, 'old-task', 'joined', ?)`).run(now());
  const mine = await call<TaskView>(almatySmall, 'GET', '/api/tasks/old-task');
  assert.deepEqual([mine.status, mine.data.closed], [200, true]);
});

test('participant limit: joining closes when the task is full, people already in stay in', async () => {
  task('two-places', { max_participants: 2 });
  assert.equal((await call<TaskView>(almatyBig, 'POST', '/api/tasks/two-places/join')).status, 200);
  const second = await call<TaskView>(almatySmall, 'POST', '/api/tasks/two-places/join');
  assert.equal(second.data.full, true);
  const third = await call<{ error: string }>(astana, 'POST', '/api/tasks/two-places/join');
  assert.deepEqual([third.status, third.data.error], [409, 'task_full']);
  assert.equal((await call<TaskView>(almatySmall, 'POST', '/api/tasks/two-places/join')).status, 200, 'joining twice is fine');
  const seen = (await call<TaskView[]>(astana, 'GET', '/api/tasks')).data.find((item) => item.id === 'two-places');
  assert.equal(seen?.full, true, 'the app can say the places are taken');
});

test('announcements go only to the creators in the task\'s audience', () => {
  task('astana-launch', { audience: JSON.stringify({ mode: 'segment', cities: ['Astana'] }) });
  outbox.length = 0;
  const count = service.announceTask(db, 'astana-launch');
  assert.equal(count, 1);
  assert.deepEqual(outbox.map((message) => message.chatId), [603]);
  assert.equal(outbox[0]!.button, '/tasks/astana-launch');

  // Not yet onboarded people and rejected accounts are not told.
  db.prepare(`INSERT INTO users (id, first_name, city, created_at) VALUES (604, 'Newbie', 'Astana', ?)`).run(now());
  account.setAccountStatus(db, 603, 'rejected', 900);
  outbox.length = 0;
  assert.equal(service.announceTask(db, 'astana-launch'), 0);
  assert.throws(() => service.announceTask(db, 'draft-task'), /not open/);
});
