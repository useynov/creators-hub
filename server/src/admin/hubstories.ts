// Stories, as the team posts them: a photo or a flat colour, a headline, a short text, one
// button into the app and a last day. Owner and Manager post and change; a Viewer can look.
// A story goes up without a bot message: creators find it at the top of Home.

import type { Hono } from 'hono';
import { now, type DB, type HubStoryRow } from '../db.js';
import { isLive, STORY_PATH } from '../hubstories.js';
import { esc, notifyUser } from '../notify.js';
import { localDate } from '../service.js';
import { audit } from './audit.js';
import { allow, EVERYONE, STAFF, type AdminEnv } from './auth.js';
import { bad, oneOf, readJson, requiredText, text } from './input.js';
import type { StoriesList, StoryAdmin, StoryInput, StoryTarget } from './types.js';

/** Only a photo we stored ourselves can go on a story: no outside addresses. */
const OUR_PHOTO = /^\/media\/(covers|seed)\/[0-9a-f]{24}\.(jpg|png|webp)$|^\/brand\/[a-z0-9-]+\.webp$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Counted = HubStoryRow & { seen_by: number };
const COUNTED = `SELECT s.*, (SELECT COUNT(*) FROM hub_story_views v WHERE v.story_id = s.id) AS seen_by FROM hub_stories s`;

const view = (row: Counted, today: string): StoryAdmin => ({
  id: row.id,
  label: row.label,
  kicker: row.kicker,
  headline: row.headline,
  body: row.body,
  imageUrl: row.image_url,
  tone: row.tone === 'red' ? 'red' : 'dark',
  buttonLabel: row.button_label,
  buttonPath: row.button_path,
  endsOn: row.ends_on,
  state: row.status !== 'live' ? 'draft' : isLive(row, today) ? 'live' : 'ended',
  seenBy: row.seen_by,
  publishedAt: row.published_at,
  updatedAt: row.updated_at,
});

/** The screens a button can open: the main ones, and every task, event and shop item creators can see now. */
export function storyTargets(db: DB): StoryTarget[] {
  const today = localDate();
  const tasks = db
    .prepare(`SELECT id, title FROM tasks WHERE active = 1 AND status = 'active' AND deadline > ? ORDER BY sort ASC`)
    .all(now()) as Array<{ id: string; title: string }>;
  const events = db
    .prepare('SELECT id, title FROM events WHERE active = 1 AND (date IS NULL OR date >= ?) ORDER BY date IS NULL, date ASC')
    .all(today) as Array<{ id: string; title: string }>;
  const items = db.prepare('SELECT id, title FROM shop_items WHERE active = 1 ORDER BY sort ASC').all() as Array<{ id: string; title: string }>;
  return [
    { path: '/tasks', title: 'Tasks', group: 'screen' },
    { path: '/events', title: 'Events', group: 'screen' },
    { path: '/shop', title: 'Shop', group: 'screen' },
    { path: '/leaderboard', title: 'Leaderboard', group: 'screen' },
    { path: '/levels', title: 'Levels', group: 'screen' },
    ...tasks.map((row): StoryTarget => ({ path: `/tasks/${row.id}`, title: row.title, group: 'task' })),
    ...events.map((row): StoryTarget => ({ path: `/events/${row.id}`, title: row.title, group: 'event' })),
    ...items.map((row): StoryTarget => ({ path: `/shop/${row.id}`, title: row.title, group: 'shop' })),
  ];
}

export function listStories(db: DB): StoriesList {
  const today = localDate();
  const rows = db.prepare(`${COUNTED} ORDER BY COALESCE(s.published_at, s.created_at) DESC, s.id DESC`).all() as Counted[];
  const rank = { live: 0, draft: 1, ended: 2 };
  const stories = rows.map((row) => view(row, today)).sort((a, b) => rank[a.state] - rank[b.state]);
  return { stories, targets: storyTargets(db), today };
}

export function getStory(db: DB, id: number): StoryAdmin {
  const row = db.prepare(`${COUNTED} WHERE s.id = ?`).get(id) as Counted | undefined;
  if (!row) throw bad('not_found', 'This story does not exist.', 404);
  return view(row, localDate());
}

export function parseStory(raw: Record<string, unknown>): StoryInput {
  const imageUrl = text(raw.imageUrl, 'imageUrl', { max: 120 });
  if (imageUrl !== null && !OUR_PHOTO.test(imageUrl)) throw bad('bad_photo', 'Upload the photo here first.');

  const buttonLabel = text(raw.buttonLabel, 'buttonLabel', { max: 28 });
  const buttonPath = text(raw.buttonPath, 'buttonPath', { max: 80 });
  if (buttonPath !== null && !STORY_PATH.test(buttonPath)) throw bad('bad_target', 'Choose where the button leads from the list.');
  if (Boolean(buttonLabel) !== Boolean(buttonPath)) throw bad('button_incomplete', 'A button needs both its words and where it leads.');

  const endsOn = text(raw.endsOn, 'endsOn', { max: 10 });
  if (endsOn !== null && (!DAY.test(endsOn) || Number.isNaN(Date.parse(`${endsOn}T00:00:00Z`)))) throw bad('bad_date', 'endsOn must be YYYY-MM-DD.');

  return {
    label: requiredText(raw.label, 'label', { max: 14, min: 2 }),
    kicker: text(raw.kicker, 'kicker', { max: 48 }),
    headline: requiredText(raw.headline, 'headline', { max: 70, min: 3 }),
    body: text(raw.body, 'body', { max: 220, multiline: true }),
    imageUrl,
    tone: oneOf(raw.tone ?? 'dark', 'tone', ['dark', 'red'] as const),
    buttonLabel,
    buttonPath,
    endsOn,
  };
}

const columns = (story: StoryInput) => ({
  label: story.label,
  kicker: story.kicker,
  headline: story.headline,
  body: story.body,
  image_url: story.imageUrl,
  tone: story.tone,
  button_label: story.buttonLabel,
  button_path: story.buttonPath,
  ends_on: story.endsOn,
});

/** A new story starts as a draft, or goes straight up when `publish` is set. */
export function createStory(db: DB, actorId: number, story: StoryInput, publish: boolean): StoryAdmin {
  if (publish) assertFuture(story);
  const id = Number(
    db
      .prepare(
        `INSERT INTO hub_stories (label, kicker, headline, body, image_url, tone, button_label, button_path, ends_on, status, created_by, created_at, updated_at, published_at)
         VALUES (@label, @kicker, @headline, @body, @image_url, @tone, @button_label, @button_path, @ends_on, @status, @actor, @at, @at, @published)`,
      )
      .run({ ...columns(story), status: publish ? 'live' : 'draft', actor: actorId, at: now(), published: publish ? now() : null }).lastInsertRowid,
  );
  audit(db, actorId, publish ? 'story.publish' : 'story.create', id, story.label);
  return getStory(db, id);
}

export function updateStory(db: DB, actorId: number, id: number, story: StoryInput): StoryAdmin {
  getStory(db, id);
  db.prepare(
    `UPDATE hub_stories SET label = @label, kicker = @kicker, headline = @headline, body = @body, image_url = @image_url, tone = @tone,
       button_label = @button_label, button_path = @button_path, ends_on = @ends_on, updated_at = @at WHERE id = @id`,
  ).run({ ...columns(story), id, at: now() });
  audit(db, actorId, 'story.update', id, story.label);
  return getStory(db, id);
}

function assertFuture(story: { endsOn: string | null }): void {
  if (story.endsOn && story.endsOn < localDate()) throw bad('ends_past', 'The last day has already passed. Move it to put the story up.');
}

/** Puts a story up, or takes it down. Putting an old one up again makes it new for everyone. */
export function setStoryLive(db: DB, actorId: number, id: number, live: boolean): StoryAdmin {
  const story = getStory(db, id);
  if (live) {
    assertFuture(story);
    db.transaction(() => {
      if (story.state !== 'live') db.prepare('DELETE FROM hub_story_views WHERE story_id = ?').run(id);
      db.prepare(`UPDATE hub_stories SET status = 'live', published_at = CASE WHEN status = 'live' THEN published_at ELSE @at END, updated_at = @at WHERE id = @id`).run({ id, at: now() });
    })();
  } else {
    db.prepare(`UPDATE hub_stories SET status = 'draft', updated_at = ? WHERE id = ?`).run(now(), id);
  }
  audit(db, actorId, live ? 'story.publish' : 'story.hide', id, story.label);
  return getStory(db, id);
}

export function removeStory(db: DB, actorId: number, id: number): void {
  const story = getStory(db, id);
  db.transaction(() => {
    db.prepare('DELETE FROM hub_story_views WHERE story_id = ?').run(id);
    db.prepare('DELETE FROM hub_stories WHERE id = ?').run(id);
  })();
  audit(db, actorId, 'story.remove', id, story.label);
}

const storyId = (raw: string | undefined): number => {
  const id = Number(raw);
  if (!raw || !/^\d{1,9}$/.test(raw) || id <= 0) throw bad('not_found', 'This story does not exist.', 404);
  return id;
};

export function storyRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/stories', allow(...EVERYONE), (c) => c.json(listStories(db)));

  api.post('/stories', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    return c.json(createStory(db, c.get('actor').id, parseStory(body), body.publish === true));
  });
  api.put('/stories/:id', allow(...STAFF), async (c) => c.json(updateStory(db, c.get('actor').id, storyId(c.req.param('id')), parseStory(await readJson(c)))));
  api.post('/stories/:id/live', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    return c.json(setStoryLive(db, c.get('actor').id, storyId(c.req.param('id')), body.live === true));
  });
  api.delete('/stories/:id', allow(...STAFF), (c) => {
    removeStory(db, c.get('actor').id, storyId(c.req.param('id')));
    return c.json({ ok: true });
  });

  // "Send it to my Telegram": the bot sends a button that opens this story in the real app,
  // also while it is still a draft.
  api.post('/stories/:id/send', allow(...STAFF), async (c) => {
    const story = getStory(db, storyId(c.req.param('id')));
    await notifyUser(
      c.get('actor').id,
      `<b>Story: ${esc(story.headline)}</b>\n${story.state === 'live' ? 'This is how creators see it.' : 'Not up for creators: only the team can open it.'}`,
      { text: 'Open in the app', path: `/hub/${story.id}?preview=1` },
    );
    return c.json({ ok: true });
  });
}
