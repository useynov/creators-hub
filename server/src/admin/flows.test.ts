import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCreator, addMember, call, login, MANAGER_ID, now, OWNER_ID, setup } from './harness.test.js';

const ExcelJS = (await import('exceljs')).default;
const { outbox } = await import('../notify.js');
const { balanceOf, ratingOf } = await import('../service.js');
const { fromLocalInput, toLocalInput } = await import('./common.js');

const { db, app } = setup();
addMember(db, MANAGER_ID, 'manager');
const owner = await login(app, db, OWNER_ID);
const manager = await login(app, db, MANAGER_ID);

// Creators: Almaty food people of different sizes, one in Astana, one pending, one rejected.
addCreator(db, 1001, { name: 'Aruzhan', instagram: 'aruzhan.vibes', followers: 2800, tags: ['food'] });
addCreator(db, 1002, { name: 'Dana', instagram: 'dana.almaty', followers: 5000, tags: ['food', 'students'] });
addCreator(db, 1003, { name: 'Timur', instagram: 'timur.shoots', city: 'Astana', followers: 900 });
addCreator(db, 1004, { name: 'Sanzhar', instagram: 'sanzh.daily', status: 'pending', followers: 1500 });
addCreator(db, 1005, { name: 'Zhan', instagram: 'zhan.food', status: 'rejected', followers: 3000, tags: ['food'] });

const inbox = (userId: number): string[] => outbox.filter((m) => m.chatId === userId).map((m) => m.html);

function localIn(days: number): string {
  return toLocalInput(new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString())!;
}

const draftTask = {
  title: 'Новогодний стол',
  summary: 'A reel of your New Year table.',
  brief: 'Mood\n\nWarm and cosy.',
  steps: ['Set the table.', 'Shoot a reel.'],
  place: null,
  date: null,
  formats: ['reel'],
  requiredMention: '@cocacola_kz',
  requiredHashtag: '#NewYearTable',
  reviewMode: 'draft_first',
  reward: 15,
  maxPublications: 2,
  bonusCoins: 100,
  maxParticipants: 1,
  startsAt: localIn(1),
  deadline: localIn(10),
  audience: { mode: 'segment', cities: ['Almaty'], tags: ['food'], followersMin: 1000, followersMax: 6000 },
};

test('time: the editor works in the hub’s wall-clock time and stores UTC', () => {
  assert.equal(fromLocalInput('2026-12-25T23:59'), '2026-12-25T18:59:00.000Z');
  assert.equal(toLocalInput('2026-12-25T18:59:00.000Z'), '2026-12-25T23:59');
  assert.equal(fromLocalInput('2026-02-30T10:00'), null);
  assert.equal(fromLocalInput('25.12.2026'), null);
});

test('audience count: segment, list, rejected accounts never counted, budget ceiling', async () => {
  const everyone = await call(app, manager, 'POST', '/api/admin/tasks/audience', { audience: { mode: 'all' }, reward: 5, maxPublications: 1 });
  assert.equal(everyone.status, 200);
  assert.equal(everyone.data.total, 4, 'the rejected account is not in the Hub audience');
  assert.equal(everyone.data.count, 4);
  assert.equal(everyone.data.budgetCoins, 20);

  const segment = await call(app, manager, 'POST', '/api/admin/tasks/audience', { ...draftTask, audience: draftTask.audience });
  assert.equal(segment.data.count, 2, 'Aruzhan and Dana: Almaty, food, 1000 to 6000 followers');
  assert.equal(segment.data.budgetCoins, 15 * 2 * 1 + 100, 'limited to one participant, plus the bonus');
  assert.equal(segment.data.budgetMoney, null, 'no coin rate yet');

  const list = await call(app, manager, 'POST', '/api/admin/tasks/audience', { audience: { mode: 'list', userIds: [1003, 1005, 424242] } });
  assert.equal(list.data.count, 1, 'unknown ids are dropped, the rejected account does not count');

  const bad = await call(app, manager, 'POST', '/api/admin/tasks/audience', { audience: { mode: 'segment', followersMin: 10, followersMax: 5 } });
  assert.equal(bad.status, 400);
});

let createdId = '';

test('task: create as a draft, with a unique slug from the title', async () => {
  const saved = await call(app, manager, 'POST', '/api/admin/tasks', { action: 'save', task: draftTask });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  createdId = saved.data.task.id;
  assert.equal(createdId, 'novogodniy-stol');
  assert.equal(saved.data.task.status, 'draft');
  assert.equal(saved.data.task.requiredMention, 'cocacola_kz');
  assert.equal(saved.data.task.requiredHashtag, 'NewYearTable');
  assert.equal(saved.data.task.deadline, draftTask.deadline);
  assert.equal(saved.data.announced, null);
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(createdId) as Record<string, unknown>;
  assert.equal(row.source, 'admin');
  assert.equal(row.format, 'Reel');
  assert.deepEqual(JSON.parse(row.audience as string).mode, 'segment');

  const twin = await call(app, manager, 'POST', '/api/admin/tasks', { action: 'save', task: draftTask });
  assert.equal(twin.data.task.id, 'novogodniy-stol-2');

  const tabs = await call(app, manager, 'GET', '/api/admin/tasks?tab=draft');
  assert.equal(tabs.data.counts.draft, 2);
  assert.equal(tabs.data.rows[0].reach, 2);
});

test('task: input is checked field by field', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ title: 'x' }, 'too_short'],
    [{ title: 'A'.repeat(121) }, 'too_long'],
    [{ reward: -1 }, 'out_of_range'],
    [{ reward: '5' }, 'bad_field'],
    [{ maxPublications: 9 }, 'out_of_range'],
    [{ formats: ['reel', 'carousel'] }, 'bad_field'],
    [{ requiredMention: 'not a handle!' }, 'bad_mention'],
    [{ requiredHashtag: 'two words' }, 'bad_hashtag'],
    [{ deadline: '2026-13-40T99:99' }, 'bad_date'],
    [{ startsAt: localIn(20), deadline: localIn(10) }, 'bad_range'],
    [{ coverUrl: 'https://evil.example/x.png' }, 'bad_cover'],
    [{ coverUrl: '/media/covers/../../private/x.png' }, 'bad_cover'],
    [{ reviewMode: 'whenever' }, 'bad_field'],
    [{ steps: 'one step' }, 'bad_field'],
    [{ audience: { mode: 'list', userIds: ['1001'] } }, 'bad_field'],
  ];
  for (const [patch, code] of cases) {
    const answer = await call(app, manager, 'POST', '/api/admin/tasks', { action: 'save', task: { ...draftTask, ...patch } });
    assert.equal(answer.status, 400, JSON.stringify(patch));
    assert.equal(answer.data.error, code, JSON.stringify(patch));
  }
  const past = await call(app, manager, 'POST', '/api/admin/tasks', {
    action: 'publish',
    task: { ...draftTask, startsAt: null, deadline: localIn(-1) },
  });
  assert.equal(past.data.error, 'deadline_past');
});

test('task: publish and announce messages the audience once, however often it is pressed', async () => {
  outbox.length = 0;
  const first = await call(app, manager, 'PUT', `/api/admin/tasks/${createdId}`, { action: 'announce', task: draftTask });
  assert.equal(first.status, 200);
  assert.equal(first.data.task.status, 'active');
  assert.equal(typeof first.data.announced, 'number');
  const messaged = outbox.length;
  assert.ok(messaged > 0);
  const second = await call(app, manager, 'PUT', `/api/admin/tasks/${createdId}`, { action: 'announce', task: draftTask });
  assert.equal(second.data.announced, null);
  assert.equal(outbox.length, messaged, 'no second round of messages');
  const tabs = await call(app, manager, 'GET', '/api/admin/tasks?tab=active');
  assert.ok(tabs.data.rows.some((row: { id: string }) => row.id === createdId));

  const closed = await call(app, manager, 'POST', `/api/admin/tasks/${createdId}/close`);
  assert.equal(closed.data.status, 'closed');
  const audit = db.prepare(`SELECT action, detail FROM audit_log WHERE target = ? ORDER BY id`).all(createdId) as Array<{ action: string; detail: string }>;
  assert.deepEqual(audit.map((row) => row.action), ['task.create', 'task.update', 'task.update', 'task.close']);
});

test('task: editing a seed task makes it the admin’s; the content file no longer overwrites it', async () => {
  const before = await call(app, owner, 'GET', '/api/admin/tasks/caravan-shoot');
  assert.equal(before.data.source, 'seed');
  assert.equal(before.data.remoteCover, true, 'the remote cover from the content file is kept, not shown');
  const { coverUrl: _drop, ...rest } = before.data;
  const edited = await call(app, owner, 'PUT', '/api/admin/tasks/caravan-shoot', { action: 'save', task: { ...rest, title: 'Caravan, edited', reward: 7 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.task.source, 'admin');
  const { syncContent } = await import('../db.js');
  syncContent(db);
  const row = db.prepare('SELECT title, reward, cover_url FROM tasks WHERE id = ?').get('caravan-shoot') as { title: string; reward: number; cover_url: string };
  assert.equal(row.title, 'Caravan, edited');
  assert.equal(row.reward, 7);
  assert.match(row.cover_url, /^https:\/\//, 'the cover survived the edit');
});

test('cover upload: images only, by content, into the public zone', async () => {
  const send = (bytes: Buffer, name: string) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)]), name);
    return app.request('http://localhost/api/admin/uploads/cover', {
      method: 'POST',
      headers: { cookie: manager, 'x-requested-with': 'creators-hub-admin' },
      body: form,
    });
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const ok = await send(png, 'cover.txt');
  assert.equal(ok.status, 200);
  const { url } = (await ok.json()) as { url: string };
  assert.match(url, /^\/media\/covers\/[0-9a-f]{24}\.png$/);
  assert.equal((await app.request(`http://localhost${url}`)).status, 200);

  const html = await send(Buffer.from('<html><script>alert(1)</script></html>'), 'cover.png');
  assert.equal(html.status, 400);
  const mp4 = await send(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(16)]), 'cover.png');
  assert.equal(mp4.status, 400, 'a video is not a cover');
  const huge = await send(Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]), 'big.png');
  assert.equal(huge.status, 413);
});

// --- Review ----------------------------------------------------------------------

function submission(userId: number, taskId: string, status: string): number {
  const entry = db
    .prepare(`INSERT INTO entries (user_id, task_id, status, joined_at, links, submitted_at, draft_sent_at, draft_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, taskId, status, now(), '["https://instagram.com/reel/abc"]', now(), now(), 'https://drive.example/draft');
  return Number(entry.lastInsertRowid);
}

test('review: approve pays once, refuses while the account is unconfirmed; changes and drafts', async () => {
  const work = submission(1001, 'new-year-post', 'in_review');
  db.prepare(
    `INSERT INTO publications (entry_id, user_id, task_id, url, kind, checks, views, likes, comments, views_source, created_at)
     VALUES (?, 1001, 'new-year-post', 'https://instagram.com/reel/abc', 'reel', ?, 1240, 96, 12, 'auto', ?)`,
  ).run(work, JSON.stringify({ ownAccount: 'pass', afterStart: 'pass', mention: 'fail', hashtag: 'pass', format: 'pass', reachable: 'pass' }), now());

  const queues = await call(app, manager, 'GET', '/api/admin/review');
  const item = queues.data.works.find((w: { entryId: number }) => w.entryId === work);
  assert.equal(item.flag, 'mention');

  const detail = await call(app, manager, 'GET', `/api/admin/review/entries/${work}`);
  assert.equal(detail.data.publications[0].checks.mention, 'fail');
  assert.equal(detail.data.creator.avgReelViews, 1000);

  const before = balanceOf(db, 1001);
  const approved = await call(app, manager, 'POST', `/api/admin/review/entries/${work}/approve`, { score: 4 });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.status, 'approved');
  const twice = await call(app, manager, 'POST', `/api/admin/review/entries/${work}/approve`, { score: 4 });
  assert.equal(twice.status, 400);
  assert.equal(twice.data.error, 'wrong_step');
  assert.equal(balanceOf(db, 1001) - before, 15, 'paid exactly once');
  assert.equal((await call(app, manager, 'POST', `/api/admin/review/entries/${work}/approve`, { score: 9 })).status, 400);

  const pending = submission(1004, 'new-year-post', 'in_review');
  const refused = await call(app, manager, 'POST', `/api/admin/review/entries/${pending}/approve`, { score: 5 });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'account_not_confirmed');
  assert.equal(balanceOf(db, 1004), 0);

  const changes = await call(app, manager, 'POST', `/api/admin/review/entries/${pending}/changes`, { comment: 'Add the brand mention.' });
  assert.equal(changes.data.status, 'needs_changes');
  assert.equal((await call(app, manager, 'POST', `/api/admin/review/entries/${pending}/changes`, { comment: '   ' })).status, 400);

  const draft = submission(1002, 'new-year-table-reel', 'draft_review');
  const draftOk = await call(app, manager, 'POST', `/api/admin/review/entries/${draft}/approve-draft`);
  assert.equal(draftOk.data.status, 'draft_approved');
  assert.equal((await call(app, manager, 'POST', `/api/admin/review/entries/${draft}/approve-draft`)).status, 400);

  const actions = (db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'review.%' ORDER BY id`).all() as Array<{ action: string }>).map((r) => r.action);
  assert.deepEqual(actions, ['review.approve', 'review.changes', 'review.approve_draft']);
});

test('review: recheck, story numbers and the account decision go through the creator-side functions', async () => {
  const entry = submission(1002, 'caravan-shoot', 'approved');
  const story = db
    .prepare(
      `INSERT INTO publications (entry_id, user_id, task_id, url, kind, story_views, views_source, story_answered_at, created_at)
       VALUES (?, 1002, 'caravan-shoot', 'https://instagram.com/stories/dana/1', 'story', 640, 'creator', ?, ?)`,
    )
    .run(entry, now(), now());
  const id = Number(story.lastInsertRowid);
  const queues = await call(app, manager, 'GET', '/api/admin/review');
  assert.ok(queues.data.stories.some((s: { publicationId: number }) => s.publicationId === id));

  const fix = await call(app, manager, 'POST', `/api/admin/review/stories/${id}/views`, { views: 700 });
  assert.equal(fix.status, 200);
  const fixed = db.prepare('SELECT story_views, views_source, story_checked_at, story_checked_by FROM publications WHERE id = ?').get(id) as {
    story_views: number;
    views_source: string;
    story_checked_at: string | null;
    story_checked_by: number | null;
  };
  assert.equal(fixed.story_views, 700, 'the team’s number replaces the stated one');
  assert.equal(fixed.story_checked_by, MANAGER_ID, 'and the report says who corrected it');
  assert.ok(fixed.story_checked_at);
  const kept = await call(app, manager, 'POST', `/api/admin/review/stories/${id}/confirm`);
  assert.equal(kept.status, 200);
  assert.ok(!kept.data.stories.some((s: { publicationId: number }) => s.publicationId === id), 'checked stories leave the queue');

  const account = await call(app, manager, 'POST', '/api/admin/creators/1004/account', { status: 'confirmed' });
  assert.equal(account.status, 200);
  assert.equal(account.data.accountStatus, 'confirmed');
  const reject = await call(app, manager, 'POST', '/api/admin/creators/1004/account', { status: 'rejected' });
  assert.equal(reject.status, 400, 'a rejection needs a note for the creator');
});

// --- Report ----------------------------------------------------------------------

test('report: totals, rows with four measurements, filters, and an Excel file of the same rows', async () => {
  // A fresh task with three publications: a measured reel, a photo post, a removed reel, and a stated story.
  addCreator(db, 1010, { name: 'Miras', instagram: 'miras.vlog' });
  db.prepare(
    `INSERT INTO tasks (id, title, reward, deadline, status, source) VALUES ('report-task', 'Report task', 5, ?, 'active', 'admin')`,
  ).run(new Date(Date.now() + 86_400_000).toISOString());
  const pub = (userId: number, kind: string, fields: Record<string, unknown>, snaps: Array<[string, number | null, string]>) => {
    const entry = submission(userId, 'report-task', 'approved');
    db.prepare(`UPDATE entries SET reward = 5 WHERE id = ?`).run(entry);
    const id = Number(
      db
        .prepare(
          `INSERT INTO publications (entry_id, user_id, task_id, url, kind, status, views, likes, comments, views_source, story_views, story_screenshot_path, created_at)
           VALUES (@entry, @user, 'report-task', @url, @kind, @status, @views, @likes, @comments, @source, @story, @shot, @at)`,
        )
        .run({ entry, user: userId, url: `https://instagram.com/${kind}/${userId}`, kind, status: 'final', views: null, likes: null, comments: null, source: 'auto', story: null, shot: null, at: now(), ...fields })
        .lastInsertRowid,
    );
    for (const [snap, views, status] of snaps) {
      db.prepare('INSERT INTO snapshots (publication_id, kind, due_at, taken_at, status, views) VALUES (?, ?, ?, ?, ?, ?)').run(id, snap, now(), now(), status, views);
    }
  };
  pub(1001, 'reel', { views: 18400, likes: 1520, comments: 84 }, [['submit', 2100, 'done'], ['h24', 9800, 'done'], ['d7', 16900, 'done'], ['d14', 18400, 'done']]);
  pub(1002, 'post', { likes: 402, comments: 23 }, [['submit', null, 'done'], ['h24', null, 'done'], ['d7', null, 'done'], ['d14', null, 'done']]);
  pub(1010, 'reel', { status: 'removed', views: 3300, likes: 50, comments: 2 }, [['submit', 700, 'done'], ['h24', 3300, 'done'], ['d7', null, 'skipped'], ['d14', null, 'skipped']]);
  pub(1003, 'story', { views_source: 'creator', story: 640, shot: 'screens/x.png' } as Record<string, unknown>, []);
  db.prepare(`UPDATE publications SET views_source = 'creator', story_views = 640, story_screenshot_path = 'screens/x.png' WHERE task_id = 'report-task' AND kind = 'story'`).run();

  const report = await call(app, owner, 'GET', '/api/admin/reports/report-task');
  assert.equal(report.status, 200);
  const t = report.data.totals;
  assert.equal(t.publications, 4);
  assert.deepEqual(t.byKind, { reel: 2, post: 1, story: 1 });
  assert.equal(t.creators, 4);
  assert.equal(t.views, 18400 + 3300 + 640);
  assert.equal(t.statedViews, 640);
  assert.equal(t.likesComments, 1520 + 84 + 402 + 23 + 50 + 2);
  assert.equal(t.coinsPaid, 20);
  assert.equal(t.approved, 4);
  assert.equal(t.removed, 1);
  assert.equal(t.costPer1000, null, 'no coin rate yet');
  assert.equal(report.data.rows[0].views, 18400, 'sorted by the final number, highest first');
  const story = report.data.rows.find((r: { kind: string }) => r.kind === 'story');
  assert.equal(story.source, 'creator_screenshot');
  assert.equal(story.cells.d14.views, 640);
  const post = report.data.rows.find((r: { kind: string }) => r.kind === 'post');
  assert.equal(post.source, 'auto_no_views');

  const reels = await call(app, owner, 'GET', '/api/admin/reports/report-task?kind=reel&sort=creator&dir=asc');
  assert.deepEqual(reels.data.rows.map((r: { name: string }) => r.name), ['Aruzhan', 'Miras']);
  const removed = await call(app, owner, 'GET', '/api/admin/reports/report-task?status=removed');
  assert.equal(removed.data.total, 1);
  const weird = await call(app, owner, 'GET', '/api/admin/reports/report-task?kind=%27%3BDROP&sort=evil');
  assert.equal(weird.data.total, 4, 'unknown filters fall back to everything');

  const file = await call(app, owner, 'GET', '/api/admin/reports/report-task/export?kind=reel&sort=creator&dir=asc&lang=ru');
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type') ?? '', /spreadsheetml/);
  assert.match(file.headers.get('content-disposition') ?? '', /attachment; filename="report-report-task\.xlsx"/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file.data as ArrayBuffer);
  const sheet = book.getWorksheet('Отчет')!;
  assert.equal(sheet.getRow(1).getCell(1).value, 'Креатор');
  assert.equal(sheet.rowCount, 3, 'header and the two reels, as the table shows them');
  assert.equal(sheet.getRow(2).getCell(1).value, 'Aruzhan');
  assert.equal(sheet.getRow(2).getCell(9).value, 18400);
  assert.equal(sheet.getRow(3).getCell(13).value, 'Удалена');

  const en = await call(app, owner, 'GET', '/api/admin/reports/report-task/export?lang=en');
  const enBook = new ExcelJS.Workbook();
  await enBook.xlsx.load(en.data as ArrayBuffer);
  const enSheet = enBook.getWorksheet('Report')!;
  assert.equal(enSheet.rowCount, 5);
  const postRow = [2, 3, 4, 5].map((n) => enSheet.getRow(n)).find((row) => row.getCell(4).value === 'Post')!;
  assert.equal(postRow.getCell(9).value, 'not public');
  assert.equal(enBook.getWorksheet('Totals')!.getRow(5).getCell(2).value, 18400 + 3300 + 640);
});

test('Excel: text a creator typed is written as text, never as a formula', async () => {
  db.prepare(`UPDATE users SET first_name = '=HYPERLINK("https://evil.example","x")' WHERE id = 1010`).run();
  const file = await call(app, owner, 'GET', '/api/admin/reports/report-task/export?status=removed');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file.data as ArrayBuffer);
  const cell = book.getWorksheet('Отчет')!.getRow(2).getCell(1);
  assert.equal(cell.type, ExcelJS.ValueType.String);
  db.prepare(`UPDATE users SET first_name = 'Miras' WHERE id = 1010`).run();
});

// --- Orders and payouts --------------------------------------------------------------

test('orders: one step at a time, a bot message on each step, a second press changes nothing', async () => {
  db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, created_at) VALUES (1002, 100, 'Seed', 'bonus', ?)`).run(now());
  const id = Number(
    db
      .prepare(`INSERT INTO orders (user_id, item_id, title, price, size, address, phone, created_at) VALUES (1002, 'hoodie', 'Hoodie', 60, 'S', 'Abay 1', '+7 701 000 00 00', ?)`)
      .run(now()).lastInsertRowid,
  );
  outbox.length = 0;
  const list = await call(app, manager, 'GET', '/api/admin/orders?status=new');
  assert.equal(list.data.counts.new, 1);
  assert.equal(list.data.rows[0].address, 'Abay 1');

  for (const [from, word] of [['new', 'packed'], ['packed', 'on its way'], ['shipped', 'Delivered']] as const) {
    const step = await call(app, manager, 'POST', `/api/admin/orders/${id}/advance`, { from });
    assert.equal(step.status, 200);
    assert.match(inbox(1002).at(-1) ?? '', new RegExp(word));
    const again = await call(app, manager, 'POST', `/api/admin/orders/${id}/advance`, { from });
    assert.equal(again.status, 409);
  }
  assert.equal(inbox(1002).length, 3, 'one message per step, never two');
  assert.equal((await call(app, manager, 'POST', `/api/admin/orders/${id}/advance`, { from: 'delivered' })).status, 409);
  assert.equal((await call(app, manager, 'POST', `/api/admin/orders/${id}/advance`, { from: 'lost' })).status, 400);

  const file = await call(app, manager, 'GET', '/api/admin/orders/export?status=delivered&lang=en');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file.data as ArrayBuffer);
  const sheet = book.getWorksheet('Orders')!;
  assert.equal(sheet.getRow(2).getCell(6).value, 'Abay 1');
  assert.equal(sheet.getRow(2).getCell(10).value, 'Delivered');
});

test('payouts: the Owner marks paid or rejects; a rejection returns the coins once; the Manager only reads', async () => {
  db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, created_at) VALUES (1001, 300, 'Seed', 'bonus', ?)`).run(now());
  const request = (coins: number): number => {
    const id = Number(db.prepare(`INSERT INTO cashouts (user_id, coins, details, created_at) VALUES (1001, ?, 'Kaspi 4400', ?)`).run(coins, now()).lastInsertRowid);
    db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (1001, ?, 'Cash-out', 'cashout', ?, ?)`).run(-coins, String(id), now());
    return id;
  };
  const paid = request(100);
  const rejected = request(80);
  const start = balanceOf(db, 1001);

  const read = await call(app, manager, 'GET', '/api/admin/payouts?status=new');
  assert.equal(read.data.canDecide, false);
  assert.equal(read.data.rows.length, 2);
  assert.equal((await call(app, manager, 'POST', `/api/admin/payouts/${paid}/paid`)).status, 403);

  outbox.length = 0;
  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${paid}/paid`)).status, 200);
  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${paid}/paid`)).status, 409, 'cannot pay twice');
  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${paid}/reject`, { note: 'Late' })).status, 409, 'a paid request cannot be refunded');
  assert.equal(balanceOf(db, 1001), start, 'paying moves no coins: they left at the request');

  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${rejected}/reject`, {})).status, 400, 'a note is needed');
  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${rejected}/reject`, { note: 'Card <b>mismatch</b>' })).status, 200);
  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${rejected}/reject`, { note: 'Again' })).status, 409);
  assert.equal((await call(app, owner, 'POST', `/api/admin/payouts/${rejected}/paid`)).status, 409);
  assert.equal(balanceOf(db, 1001), start + 80, 'the coins came back exactly once');
  const messages = inbox(1001);
  assert.equal(messages.length, 2);
  assert.match(messages[1]!, /Card &lt;b&gt;mismatch&lt;\/b&gt;/, 'the note is escaped in the bot message');

  const audit = db.prepare(`SELECT action, detail FROM audit_log WHERE action LIKE 'payout.%'`).all() as Array<{ action: string; detail: string }>;
  assert.deepEqual(audit.map((row) => row.action), ['payout.paid', 'payout.rejected']);
  assert.ok(audit.every((row) => !row.detail.includes('Kaspi') && !row.detail.includes('mismatch')), 'no payout details or notes in the log');
});

// --- Creators and invitations ---------------------------------------------------------

test('creators: search, filters, sorting and paging happen on the server', async () => {
  // Sanzhar was confirmed in the review test above: a new account waits for the team here.
  addCreator(db, 1020, { name: 'Zarina', instagram: 'zarina.films', status: 'pending', city: 'Shymkent', followers: 800 });
  const all = await call(app, manager, 'GET', '/api/admin/creators?pageSize=10');
  assert.equal(all.status, 200);
  assert.equal(all.data.inHub, all.data.total);
  assert.equal(all.data.rows[0].accountStatus, 'pending', 'accounts to confirm come first');

  const food = await call(app, manager, 'GET', '/api/admin/creators?tag=food&sort=followers&dir=desc');
  assert.deepEqual(food.data.rows.map((r: { name: string }) => r.name), ['Dana', 'Zhan', 'Aruzhan']);
  const range = await call(app, manager, 'GET', '/api/admin/creators?followersMin=1000&followersMax=3000&city=almaty&sort=name');
  assert.deepEqual(range.data.rows.map((r: { name: string }) => r.name), ['Aruzhan', 'Miras', 'Sanzhar', 'Zhan']);
  const search = await call(app, manager, 'GET', '/api/admin/creators?q=%40dana');
  assert.deepEqual(search.data.rows.map((r: { name: string }) => r.name), ['Dana']);
  const literal = await call(app, manager, 'GET', '/api/admin/creators?q=%25');
  assert.equal(literal.data.total, 0, 'a % in the search is a character, not a wildcard');
  const paged = await call(app, manager, 'GET', '/api/admin/creators?pageSize=10&page=2&sort=name');
  assert.equal(paged.data.rows.length, Math.max(0, all.data.total - 10));
  // The rating in the list is the same whole number as ratingOf, views counted in whole points.
  db.prepare(`UPDATE entries SET views = 1234 WHERE user_id = 1001 AND status = 'approved'`).run();
  const rated = await call(app, manager, 'GET', '/api/admin/creators?pageSize=100');
  for (const row of rated.data.rows as Array<{ id: number; rating: number }>) {
    assert.ok(Number.isInteger(row.rating));
    assert.equal(row.rating, ratingOf(db, row.id));
  }
  const injected = await call(app, manager, 'GET', `/api/admin/creators?sort=${encodeURIComponent('name; DROP TABLE users')}&dir=sideways`);
  assert.equal(injected.status, 200);
  assert.ok(db.prepare('SELECT 1 FROM users LIMIT 1').get());
});

test('creator card: tags, level by the Owner only, refresh answers calmly', async () => {
  const card = await call(app, manager, 'GET', '/api/admin/creators/1001');
  assert.equal(card.data.name, 'Aruzhan');
  assert.equal(card.data.hub.publications >= 1, true);
  const tags = await call(app, manager, 'PUT', '/api/admin/creators/1001/tags', { tags: [' Food ', 'food', 'Students'] });
  assert.deepEqual(tags.data.tags, ['food', 'students']);
  assert.equal((await call(app, manager, 'PUT', '/api/admin/creators/1001/tags', { tags: 'food' })).status, 400);
  assert.equal((await call(app, manager, 'PUT', '/api/admin/creators/1001/level', { level: 'pro' })).status, 403);
  const level = await call(app, owner, 'PUT', '/api/admin/creators/1001/level', { level: 'pro' });
  assert.equal(level.data.level, 'pro');
  assert.equal(level.data.levelOverride, 'pro');
  assert.equal((await call(app, owner, 'PUT', '/api/admin/creators/1001/level', { level: 'king' })).status, 400);
  const refresh = await call(app, manager, 'POST', '/api/admin/creators/1001/refresh');
  assert.ok([200, 503].includes(refresh.status));
  assert.equal((await call(app, manager, 'POST', '/api/admin/creators/1001/refresh')).status, 429, 'once a minute');
  assert.equal((await call(app, manager, 'GET', '/api/admin/creators/abc')).status, 404);
});

test('invitations: a list with tags, invalid entries reported, the shared link on, replaced and off', async () => {
  const sent = await call(app, manager, 'POST', '/api/admin/invites', { list: '@new_person\n1001, 123456789 not-a-handle!', tags: 'Students, food' });
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.data.results, [
    { ref: '@new_person', result: 'added' },
    { ref: '1001', result: 'exists' },
    { ref: '123456789', result: 'added' },
    { ref: 'not-a-handle!', result: 'invalid' },
  ]);
  // Someone already in the Hub gets the tags at once; someone new gets them when they arrive.
  assert.ok((await call(app, manager, 'GET', '/api/admin/creators/1001')).data.tags.includes('students'));
  db.prepare(`INSERT INTO users (id, first_name, onboarded_at, created_at) VALUES (123456789, 'Newcomer', ?, ?)`).run(now(), now());
  const newcomer = await call(app, manager, 'GET', '/api/admin/creators/123456789');
  assert.deepEqual(newcomer.data.tags, ['food', 'students']);

  const list = await call(app, manager, 'GET', '/api/admin/invites');
  const row = list.data.recent.find((r: { who: string }) => r.who === '@new_person');
  assert.equal(row.state, 'not_opened');
  assert.equal(row.by, `Member ${MANAGER_ID}`);

  const on = await call(app, manager, 'POST', '/api/admin/invites/link', { action: 'on' });
  assert.equal(on.data.on, true);
  assert.match(on.data.link, /^https:\/\/t\.me\/.+\?start=join_|^\?start=join_/);
  const replaced = await call(app, manager, 'POST', '/api/admin/invites/link', { action: 'replace' });
  assert.notEqual(replaced.data.link, on.data.link);
  const off = await call(app, manager, 'POST', '/api/admin/invites/link', { action: 'off' });
  assert.equal(off.data.on, false);
  const logged = db.prepare(`SELECT detail FROM audit_log WHERE action = 'invite.link'`).all() as Array<{ detail: string }>;
  assert.ok(logged.every((r) => !r.detail.includes('join_')), 'the code never goes into the log');
});

test('overview: counts what waits and the month in numbers', async () => {
  const overview = await call(app, owner, 'GET', '/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.data.todo.pendingAccounts >= 1);
  assert.ok(overview.data.kpi.creators >= 6);
  assert.ok(overview.data.alerts.some((a: { kind: string }) => a.kind === 'removed'));
  const me = await call(app, manager, 'GET', '/api/admin/me');
  assert.equal(me.data.counters.pendingAccounts, overview.data.todo.pendingAccounts);
});
