// /clear: the bot empties a private chat as far as Telegram lets it, and nothing else.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
process.env.CLEAR_NOTE_MS = '30';
delete process.env.ADMIN_CHAT_ID;

const { createBot } = await import('./bot.js');
const { openDb, syncContent } = await import('./db.js');
const { setApi } = await import('./notify.js');

const db = openDb(':memory:');
syncContent(db);
const bot = createBot(db);

interface Call {
  method: string;
  payload: Record<string, any>;
}
const calls: Call[] = [];
bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload: payload as Record<string, any> });
  const result = method === 'sendMessage' ? { message_id: 7777, date: 0, chat: { id: (payload as any).chat_id, type: 'private' } } : true;
  return { ok: true, result } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'Hub', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any;
setApi(bot.api);

let updateId = 0;
async function clear(from: { id: number; first_name: string }, messageId: number, chat: { id: number; type: string } = { id: from.id, type: 'private' }): Promise<Call[]> {
  calls.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: messageId, date: 0, chat, from: { ...from, is_bot: false }, text: '/clear', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 80));
  return [...calls];
}

const anyone = { id: 77, first_name: 'Nobody' };

test('/clear sweeps back from the command itself, in this chat only, then removes its own note', async () => {
  const done = await clear(anyone, 2500);
  const sweeps = done.filter((call) => call.method === 'deleteMessages');
  assert.equal(sweeps.length, 20);
  assert.ok(sweeps.every((call) => call.payload.chat_id === 77), 'never another chat');
  assert.ok(sweeps.every((call) => call.payload.message_ids.length === 100), 'Telegram takes at most 100 at a time');
  assert.equal(sweeps[0]!.payload.message_ids[0], 2500, 'the /clear message goes too');
  assert.equal(sweeps[0]!.payload.message_ids[99], 2401);
  assert.equal(sweeps[19]!.payload.message_ids[99], 501);
  const all = sweeps.flatMap((call) => call.payload.message_ids as number[]);
  assert.equal(new Set(all).size, 2000, 'no number is asked for twice');

  // The note comes after the sweep and deletes itself, so the chat ends up empty.
  const note = done.find((call) => call.method === 'sendMessage')!;
  assert.match(note.payload.text, /Cleared[\s\S]*48 hours/);
  assert.ok(done.indexOf(note) > done.indexOf(sweeps[19]!));
  const gone = done.find((call) => call.method === 'deleteMessage')!;
  assert.deepEqual([gone.payload.chat_id, gone.payload.message_id], [77, 7777]);
});

test('/clear right again only tidies the newest messages; a young chat never asks for numbers below 1', async () => {
  const again = await clear(anyone, 2510);
  assert.equal(again.filter((call) => call.method === 'deleteMessages').length, 1);

  const young = await clear({ id: 78, first_name: 'New' }, 130);
  const sweeps = young.filter((call) => call.method === 'deleteMessages');
  assert.equal(sweeps.length, 2);
  assert.deepEqual(sweeps[1]!.payload.message_ids, Array.from({ length: 30 }, (_, index) => 30 - index));
});

test('/clear in a group deletes nothing', async () => {
  const group = await clear({ id: 900, first_name: 'Dana' }, 4000, { id: -500, type: 'group' });
  assert.equal(group.filter((call) => call.method === 'deleteMessages').length, 0);
  assert.match(group.find((call) => call.method === 'sendMessage')!.payload.text, /private chat/);
});
