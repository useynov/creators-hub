// The new Home and Tasks tab: tasks that are not open yet ("Soon") and "Remind me", what Home
// lists, and the Hub's stories from posting to the grey ring.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-home-'));
delete process.env.DEV_USER_ID;
delete process.env.ADMIN_CHAT_ID;

const { openDb, syncContent, now } = await import('./db.js');
const service = await import('./service.js');
const { liveStories, markStorySeen, previewStory } = await import('./hubstories.js');
const { createStory, updateStory, setStoryLive, removeStory, listStories, parseStory, storyTargets } = await import('./admin/hubstories.js');
const { startOver } = await import('./startover.js');
const { outbox } = await import('./notify.js');
const { HubError } = await import('./errors.js');
type UserRow = import('./db.js').UserRow;

const db = openDb(':memory:');
syncContent(db);

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number): string => new Date(Date.now() + days * DAY).toISOString();
const localDay = (days: number): string => service.localDate(new Date(Date.now() + days * DAY));

function creator(id: number): UserRow {
  db.prepare(
    `INSERT INTO users (id, username, first_name, instagram, city, birth_date, onboarded_at, created_at, account_status)
     VALUES (?, ?, ?, ?, 'Almaty', '1995-05-05', ?, ?, 'confirmed')`,
  ).run(id, `user${id}`, `User${id}`, `user.${id}`, now(), now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

/** One task with the dates this test needs; everything else from the seed is switched off. */
function task(id: string, startsInDays: number | null, deadlineInDays = 20): void {
  db.prepare(
    `INSERT INTO tasks (id, title, summary, brief, reward, format, formats, deadline, starts_at, review_mode, steps, sort, active, status, audience, source, created_at)
     VALUES (?, ?, 'One line about it.', 'The full brief.', 10, 'Reel', '["reel"]', ?, ?, 'post_first', '["Shoot it.","Send the link."]', 0, 1, 'active', '{"mode":"all"}', 'admin', ?)`,
  ).run(id, `Task ${id}`, at(deadlineInDays), startsInDays === null ? null : at(startsInDays), at(-3));
}

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof HubError) return error.code;
    throw error;
  }
  return 'no error';
};

db.prepare('UPDATE tasks SET active = 0').run();
task('open-a', null);
task('open-b', -2);
task('soon-a', 5);

const story = (over: Record<string, unknown> = {}) =>
  parseStory({ label: 'Party', kicker: 'Event · 26 Dec', headline: 'Creators New Year Party', body: 'You are invited.', imageUrl: null, tone: 'dark', buttonLabel: "I'm in", buttonPath: '/events', endsOn: null, ...over });

test('a task with a start date in the future is listed as Soon, holds its brief back and cannot be joined', () => {
  const user = creator(1);
  const list = service.listTasks(db, 1);
  const soon = list.find((item) => item.id === 'soon-a')!;
  assert.ok(soon.opensAt, 'it says when it opens');
  assert.equal(soon.brief, null);
  assert.deepEqual(soon.steps, []);
  assert.equal(soon.summary, 'One line about it.', 'the one line is shown already');
  assert.equal(list.find((item) => item.id === 'open-a')!.opensAt, null);
  assert.equal(list.find((item) => item.id === 'open-b')!.opensAt, null, 'a start in the past is simply open');

  assert.equal(codeOf(() => service.joinTask(db, user, 'soon-a')), 'task_not_open');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id = 1').get() as { n: number }).n, 0);
  assert.ok(service.joinTask(db, user, 'open-a').entry, 'an open task is joined as before');
});

test('Remind me: asked once, sent once when the task opens, with the brief then visible', async () => {
  const user = creator(2);
  assert.equal(service.remindTask(db, user, 'soon-a', true).reminded, true);
  service.remindTask(db, user, 'soon-a', true);
  assert.equal(codeOf(() => service.remindTask(db, user, 'open-a', true)), 'task_open', 'an open task needs no reminder');

  // Undo, then ask again.
  assert.equal(service.remindTask(db, user, 'soon-a', false).reminded, false);
  service.remindTask(db, user, 'soon-a', true);

  outbox.length = 0;
  assert.equal(service.sendTaskReminders(db), 0, 'nothing is sent before the start');

  db.prepare(`UPDATE tasks SET starts_at = ? WHERE id = 'soon-a'`).run(at(-0.001));
  assert.equal(service.sendTaskReminders(db), 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const sent = outbox.filter((message) => message.chatId === 2);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.html, /Open now:<\/b> Task soon-a/);
  assert.equal(sent[0]!.button, '/tasks/soon-a');
  assert.equal(service.sendTaskReminders(db), 0, 'never twice');

  const opened = service.oneTask(db, 2, 'soon-a');
  assert.equal(opened.opensAt, null);
  assert.equal(opened.brief, 'The full brief.');
  assert.ok(service.joinTask(db, user, 'soon-a').entry);
  db.prepare(`UPDATE tasks SET starts_at = ? WHERE id = 'soon-a'`).run(at(5));
});

test('Home: only tasks that can be joined now, a count of what is coming, and the creator\'s own work that needs a fix', () => {
  const user = creator(3);
  let home = service.home(db, 3);
  assert.deepEqual(home.openTasks.map((item) => item.id).sort(), ['open-a', 'open-b']);
  assert.equal(home.openCount, 2);
  assert.equal(home.soonCount, 1);
  assert.deepEqual(home.needsFix, { count: 0, taskId: null });

  // Joining takes a task off Home: it now lives under Mine in the Tasks tab.
  service.joinTask(db, user, 'open-a');
  home = service.home(db, 3);
  assert.deepEqual(home.openTasks.map((item) => item.id), ['open-b']);

  // The team sends the work back: Home says so.
  db.prepare(`UPDATE entries SET status = 'needs_changes', comment = 'Tag the account.' WHERE user_id = 3 AND task_id = 'open-a'`).run();
  home = service.home(db, 3);
  assert.deepEqual(home.needsFix, { count: 1, taskId: 'open-a' });

  // A full task is not offered on Home.
  db.prepare(`UPDATE tasks SET max_participants = 1 WHERE id = 'open-b'`).run();
  service.joinTask(db, creator(4), 'open-b');
  assert.equal(service.home(db, 3).openCount, 0);
  db.prepare(`UPDATE tasks SET max_participants = NULL WHERE id = 'open-b'`).run();

  // Events: only the ones with a date, the nearest two.
  assert.ok(home.events.length <= 2);
  assert.ok(home.events.every((event) => event.date));
});

test('stories: a draft is invisible, a live one shows with a red ring until opened, the last day ends it', () => {
  creator(5);
  const draft = createStory(db, 900, story(), false);
  assert.equal(draft.state, 'draft');
  assert.deepEqual(liveStories(db, 5), []);

  const up = setStoryLive(db, 900, draft.id, true);
  assert.equal(up.state, 'live');
  let seen = liveStories(db, 5);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.seen, false);
  assert.deepEqual(seen[0]!.button, { label: "I'm in", path: '/events' });
  assert.equal(service.home(db, 5).stories.length, 1, 'Home carries the same list');

  markStorySeen(db, 5, draft.id);
  markStorySeen(db, 5, draft.id);
  seen = liveStories(db, 5);
  assert.equal(seen[0]!.seen, true);
  assert.equal(listStories(db).stories.find((item) => item.id === draft.id)!.seenBy, 1);

  // A newer story the creator has not opened comes first.
  const second = createStory(db, 900, story({ label: 'Merch', headline: 'New merch is in', buttonLabel: null, buttonPath: null, tone: 'red' }), true);
  assert.deepEqual(liveStories(db, 5).map((item) => item.id), [second.id, draft.id]);

  // Its last day was yesterday: it is gone for creators and marked ended for the team.
  updateStory(db, 900, second.id, story({ label: 'Merch', headline: 'New merch is in', buttonLabel: null, buttonPath: null, endsOn: localDay(-1) }));
  assert.deepEqual(liveStories(db, 5).map((item) => item.id), [draft.id]);
  assert.equal(listStories(db).stories.find((item) => item.id === second.id)!.state, 'ended');
  assert.equal(codeOf(() => setStoryLive(db, 900, second.id, true)), 'ends_past');

  // Today is still inside.
  updateStory(db, 900, second.id, story({ label: 'Merch', headline: 'New merch is in', buttonLabel: null, buttonPath: null, endsOn: localDay(0) }));
  assert.equal(liveStories(db, 5).length, 2);

  // Taken down and put up again: it is new for everyone.
  setStoryLive(db, 900, draft.id, false);
  assert.equal(liveStories(db, 5).some((item) => item.id === draft.id), false);
  setStoryLive(db, 900, draft.id, true);
  assert.equal(liveStories(db, 5).find((item) => item.id === draft.id)!.seen, false);

  // Only the team can open a draft; a creator asking for a preview gets the live list.
  const hidden = createStory(db, 900, story({ label: 'Secret', headline: 'Not yet' }), false);
  assert.deepEqual(previewStory(db, 900, hidden.id).map((item) => item.id), [hidden.id]);
  assert.equal(previewStory(db, 5, hidden.id).some((item) => item.id === hidden.id), false);
  markStorySeen(db, 900, hidden.id);
  assert.equal(listStories(db).stories.find((item) => item.id === hidden.id)!.seenBy, 0, 'a preview is not a view');

  removeStory(db, 900, second.id);
  assert.equal(listStories(db).stories.some((item) => item.id === second.id), false);
});

test('stories: what the team can type is checked', () => {
  assert.equal(codeOf(() => parseStory({ ...story(), imageUrl: 'https://evil.example/x.jpg' })), 'bad_photo');
  assert.equal(codeOf(() => parseStory({ ...story(), buttonPath: 'https://evil.example' })), 'bad_target');
  assert.equal(codeOf(() => parseStory({ ...story(), buttonPath: '/admin' })), 'bad_target');
  assert.equal(codeOf(() => parseStory({ ...story(), buttonLabel: null })), 'button_incomplete');
  assert.equal(codeOf(() => parseStory({ ...story(), endsOn: '31.12.2026' })), 'bad_date');
  assert.equal(codeOf(() => parseStory({ ...story(), label: '' })), 'field_required');
  assert.equal(codeOf(() => parseStory({ ...story(), tone: 'blue' })), 'bad_field');
  assert.equal(parseStory({ ...story(), buttonPath: '/tasks/open-a' }).buttonPath, '/tasks/open-a');

  // The list of places a button can open: the main screens and what creators can see now.
  const targets = storyTargets(db).map((target) => target.path);
  assert.ok(targets.includes('/tasks') && targets.includes('/leaderboard'));
  assert.ok(targets.includes('/tasks/open-a'));
  assert.ok(!targets.includes('/tasks/caravan-shoot'), 'a task that is switched off is not offered');
});

test('starting over also clears reminders and seen stories, so the account can be removed', async () => {
  const user = creator(900);
  service.remindTask(db, user, 'soon-a', true);
  const live = liveStories(db, 900)[0]!;
  markStorySeen(db, 900, live.id);
  assert.ok(await startOver(db, 900));
  assert.equal(service.getUser(db, 900), undefined);
});
