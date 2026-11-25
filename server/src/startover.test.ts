// Starting over: an owner's own creator account is removed completely, nothing else is touched,
// and the bot asks twice before it happens.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-startover-'));
delete process.env.DEV_USER_ID;
delete process.env.ADMIN_CHAT_ID;
delete process.env.WELCOME_VIDEO;

const { createBot } = await import('./bot.js');
const { openDb, syncContent, now } = await import('./db.js');
const { setApi } = await import('./notify.js');
const { saveMedia, mediaFile } = await import('./media.js');
const service = await import('./service.js');
const { placeOrder } = await import('./shop.js');
const { createItem, parseItem } = await import('./admin/shop.js');
const { startOver, startOverPreview } = await import('./startover.js');
type UserRow = import('./db.js').UserRow;

const db = openDb(':memory:');
syncContent(db);
const bot = createBot(db);

interface Call {
  method: string;
  payload: Record<string, any>;
}
const calls: Call[] = [];
let ids = 1000;
bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload: payload as Record<string, any> });
  const result = method === 'sendMessage' ? { message_id: ++ids, date: 0, chat: { id: (payload as any).chat_id, type: 'private' } } : true;
  return { ok: true, result } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'Hub', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any;
setApi(bot.api);

let updateId = 0;
async function say(from: { id: number; first_name: string; username?: string }, text: string, chat: { id: number; type: string } = { id: from.id, type: 'private' }): Promise<string[]> {
  calls.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: ++ids, date: 0, chat, from: { ...from, is_bot: false }, text, entities: [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0]!.length }] },
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return calls.filter((call) => call.method === 'sendMessage').map((call) => call.payload.text as string);
}

const owner = { id: 900, first_name: 'Dana', username: 'dana_team' };
const other = { id: 42, first_name: 'Aruzhan', username: 'aruzhan' };

// A tiny real PNG, so the avatar is a file on disk like a real one.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** A creator with everything a creator can have: a joined task, a publication with a measurement, coins, an order, an RSVP. */
async function fill(id: number, name: string): Promise<{ avatar: string }> {
  const avatar = (await saveMedia('public', 'avatars', PNG)).url!;
  db.prepare(
    `INSERT INTO users (id, username, first_name, instagram, city, address, phone, birth_date, avatar_url, onboarded_at, created_at, account_status)
     VALUES (?, ?, ?, ?, 'Almaty', 'Abay Ave 1', '+7 700 000 0000', '1995-05-05', ?, ?, ?, 'confirmed')
     ON CONFLICT(id) DO UPDATE SET instagram = excluded.instagram, city = excluded.city, address = excluded.address, phone = excluded.phone,
       birth_date = excluded.birth_date, avatar_url = excluded.avatar_url, onboarded_at = excluded.onboarded_at, account_status = 'confirmed'`,
  ).run(id, name.toLowerCase(), name, `${name.toLowerCase()}.ig`, avatar, now(), now());
  db.prepare(`INSERT INTO social_profiles (user_id, platform, handle, avatar_url, fetched_at) VALUES (?, 'instagram', ?, ?, ?)`).run(id, `${name.toLowerCase()}.ig`, avatar, now());
  db.prepare(`INSERT INTO user_tags (user_id, tag) VALUES (?, 'food')`).run(id);
  const entry = Number(
    db.prepare(`INSERT INTO entries (user_id, task_id, status, joined_at, approved_at, reward) VALUES (?, 'caravan-shoot', 'approved', ?, ?, 5)`).run(id, now(), now()).lastInsertRowid,
  );
  db.prepare(`INSERT INTO submissions (entry_id, user_id, task_id, links, status, created_at) VALUES (?, ?, 'caravan-shoot', '[]', 'done', ?)`).run(entry, id, now());
  const publication = Number(
    db.prepare(`INSERT INTO publications (entry_id, user_id, task_id, url, created_at) VALUES (?, ?, 'caravan-shoot', 'https://instagram.com/reel/x', ?)`).run(entry, id, now()).lastInsertRowid,
  );
  db.prepare(`INSERT INTO snapshots (publication_id, kind, due_at) VALUES (?, 'h24', ?)`).run(publication, now());
  db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, created_at) VALUES (?, 40, 'Test coins', 'bonus', ?)`).run(id, now());
  db.prepare(`INSERT INTO rsvps (user_id, event_id, code, created_at) VALUES (?, (SELECT id FROM events LIMIT 1), ?, ?)`).run(id, `code-${id}`, now());
  placeOrder(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow, 'cap', { address: 'Almaty, Abay Ave 1', phone: '+7 700 000 0000' });
  return { avatar };
}

const rows = (table: string, id: number, column = 'user_id'): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id) as { n: number }).n;
const stock = (): number => (db.prepare(`SELECT stock FROM shop_items WHERE id = 'cap'`).get() as { stock: number }).stock;

test('starting over removes the whole creator account, gives the item back, and touches nobody else', async () => {
  createItem(db, 900, parseItem({ title: 'Cap', description: 'A red cap.', price: 10, category: 'merch', images: [], sizes: [], delivery: 'courier', stock: 5, perCreator: null, visible: true }));
  const mine = await fill(900, 'Dana');
  const theirs = await fill(42, 'Aruzhan');
  assert.equal(stock(), 3);

  assert.deepEqual(startOverPreview(db, 900), { tasks: 1, publications: 1, coins: 30, orders: 1, cashouts: 0, rsvps: 1 });
  assert.deepEqual(await startOver(db, 900), { tasks: 1, publications: 1, coins: 30, orders: 1, cashouts: 0, rsvps: 1 });

  assert.equal(service.getUser(db, 900), undefined);
  for (const table of ['entries', 'submissions', 'publications', 'ledger', 'orders', 'rsvps', 'social_profiles', 'user_tags']) {
    assert.equal(rows(table, 900), 0, `${table} of the owner`);
    assert.ok(rows(table, 42) > 0, `${table} of the other creator`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n, 1, 'only the other creator has a measurement left');
  assert.equal(stock(), 4, 'the undelivered cap is back on the shelf');
  assert.equal(service.balanceOf(db, 42), 30);

  // Files: the owner's avatar is gone from disk, the other creator's is still there.
  assert.equal(existsSync(mediaFile('public', mine.avatar.slice('/media/'.length))!), false);
  assert.equal(existsSync(mediaFile('public', theirs.avatar.slice('/media/'.length))!), true);

  // What the owner made as team stays.
  assert.ok(db.prepare(`SELECT 1 FROM shop_items WHERE id = 'cap'`).get());

  assert.equal(await startOver(db, 900), null, 'nothing left to remove');
});

test('/startover in the bot: owners only, own account only, and only after "yes"', async () => {
  await fill(900, 'Dana');

  // Someone who is not an owner gets nothing, whatever they type.
  await say(other, '/startover yes');
  assert.ok(service.getUser(db, 42), 'a creator cannot remove an account this way');

  // A Manager is on the team, but this is for owners.
  db.prepare(`INSERT INTO team_members (telegram_id, name, role, added_by, created_at) VALUES (42, 'Aruzhan', 'manager', 900, ?)`).run(now());
  const manager = await say(other, '/startover yes');
  assert.match(manager[0]!, /Only the owners/);
  assert.ok(service.getUser(db, 42));
  db.prepare('DELETE FROM team_members WHERE telegram_id = 42').run();

  // In a group the owner is sent to the private chat.
  const inGroup = await say(owner, '/startover yes', { id: -500, type: 'group' });
  assert.match(inGroup[0]!, /private chat/);
  assert.ok(service.getUser(db, 900));

  // The first message only says what would go.
  const asked = await say(owner, '/startover');
  assert.match(asked[0]!, /Start over as a new creator\?/);
  assert.match(asked[0]!, /1 task you joined, with 1 publication/);
  assert.match(asked[0]!, /\/startover yes/);
  assert.ok(service.getUser(db, 900), 'nothing is removed before the yes');
  assert.equal(rows('entries', 900), 1);

  const done = await say(owner, '/startover yes');
  assert.match(done[0]!, /Your creator account is removed/);
  assert.equal(service.getUser(db, 900), undefined);
  assert.equal(rows('entries', 900), 0);
  assert.ok(service.getUser(db, 42), 'the other creator is untouched');
  assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'creator.startover' AND actor_id = 900`).get());

  // A second time there is nothing to remove.
  const again = await say(owner, '/startover yes');
  assert.match(again[0]!, /no creator account/);

  // /start brings the owner in as a new creator: the button opens the welcome screen, and they are still an owner.
  calls.length = 0;
  await say(owner, '/start');
  const button = calls.filter((call) => call.method === 'sendMessage').map((call) => call.payload.reply_markup?.inline_keyboard?.[0]?.[0]).find(Boolean);
  assert.equal(button.web_app.url, 'https://hub.example/welcome');
  const fresh = service.getUser(db, 900)!;
  assert.equal(fresh.instagram, null);
  assert.equal(fresh.onboarded_at, null);
  assert.equal(fresh.account_status, 'pending');
  const help = await say(owner, '/help');
  assert.match(help[0]!, /Team commands/);
  assert.match(help[0]!, /\/startover/);
});
