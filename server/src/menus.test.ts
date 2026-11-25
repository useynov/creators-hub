// The "/" list in Telegram: everyone sees every command they may use, and nothing else.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
delete process.env.ADMIN_CHAT_ID;

const { configureBot, createBot } = await import('./bot.js');
const { registerAdminBot } = await import('./admin/bot.js');
const { openDb, syncContent, now, isSampleId } = await import('./db.js');
const SAMPLE = 9900000000018;
const { COMMANDS, groupMenu, privateMenu, tierOf } = await import('./menus.js');
const { addMember, changeRole, removeMember } = await import('./admin/team.js');
const { upsertUser } = await import('./service.js');

const db = openDb(':memory:');
syncContent(db);
const bot = createBot(db);
registerAdminBot(bot, db);

interface Call {
  method: string;
  payload: Record<string, any>;
}
const calls: Call[] = [];
/** Chats Telegram does not know: people who never opened the bot. */
const strangers = new Set<number>();
bot.api.config.use(async (_prev, method, payload) => {
  const body = payload as Record<string, any>;
  calls.push({ method, payload: body });
  if (strangers.has(body.scope?.chat_id)) return { ok: false, error_code: 400, description: 'Bad Request: chat not found' } as any;
  const result = method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: body.chat_id, type: 'private' } } : true;
  return { ok: true, result } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'Hub', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any;

const names = (list: Array<{ command: string }>): string[] => list.map((entry) => entry.command);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const menuCalls = (chatId?: number): Call[] =>
  calls.filter((call) => (call.method === 'setMyCommands' || call.method === 'deleteMyCommands') && (chatId === undefined || call.payload.scope?.chat_id === chatId));

let updateId = 0;
async function say(id: number, text: string): Promise<void> {
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id, type: 'private' },
      from: { id, is_bot: false, first_name: `User ${id}` },
      text,
      entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] : undefined,
    },
  } as any);
  await settle();
}

const person = (id: number, username: string): void => {
  upsertUser(db, { id, first_name: username, username });
};

test('every command the bot answers is in the list', () => {
  const source = readFileSync(new URL('./bot.ts', import.meta.url), 'utf8') + readFileSync(new URL('./admin/bot.ts', import.meta.url), 'utf8');
  const answered = [...source.matchAll(/\.command\('([a-z_]+)'/g)].map((match) => match[1]!);
  assert.ok(answered.length > 20);
  const listed = new Set(names(COMMANDS));
  assert.deepEqual(answered.filter((command) => !listed.has(command)), [], 'a command is missing from menus.ts');
  assert.deepEqual([...listed].filter((command) => !answered.includes(command)), [], 'the list offers a command the bot does not answer');
  assert.equal(listed.size, COMMANDS.length, 'no command twice');
});

test('the lists keep to what Telegram accepts', () => {
  assert.ok(COMMANDS.length <= 100);
  for (const entry of COMMANDS) {
    assert.match(entry.command, /^[a-z0-9_]{1,32}$/);
    assert.ok(entry.description.length >= 3 && entry.description.length <= 256, entry.command);
    assert.ok(!entry.description.includes('—'), entry.command);
  }
});

test('each role sees its own commands and no more', () => {
  assert.deepEqual(names(privateMenu('creator')), ['start', 'clear']);
  assert.deepEqual(names(privateMenu('viewer')), ['start', 'admin', 'clear']);

  const team = names(privateMenu('team'));
  for (const command of ['pending', 'tasks', 'announce', 'views', 'confirm', 'reject', 'invite', 'uninvite', 'invites', 'invitelink', 'quiet', 'cancel', 'help', 'id', 'admin']) {
    assert.ok(team.includes(command), `${command} is for the whole team`);
  }
  for (const command of ['bonus', 'level', 'offer', 'allowage', 'sampledata', 'startover', 'demo']) {
    assert.ok(!team.includes(command), `${command} is the owners' call`);
  }

  const owner = names(privateMenu('owner'));
  assert.ok(['bonus', 'level', 'offer', 'allowage', 'sampledata', 'startover'].every((command) => owner.includes(command)));
  assert.ok(!owner.includes('demo'), 'only the owners named in the server settings switch demo mode');
  assert.deepEqual(names(privateMenu('root')), names(COMMANDS));

  // The team group: nothing that only works in private.
  const group = names(groupMenu());
  for (const command of ['start', 'admin', 'startover', 'clear', 'quiet']) assert.ok(!group.includes(command), command);
  assert.ok(['pending', 'confirm', 'bonus', 'help'].every((command) => group.includes(command)));
});

test('on start: creators get the short list, the owner the full one in their own chat', async () => {
  calls.length = 0;
  await configureBot(bot, db);

  const [everyone, owner] = menuCalls();
  assert.equal(everyone!.payload.scope, undefined, 'the default list has no scope');
  assert.deepEqual(names(everyone!.payload.commands), ['start', 'clear']);
  assert.deepEqual(owner!.payload.scope, { type: 'chat', chat_id: 900 });
  assert.deepEqual(names(owner!.payload.commands), names(COMMANDS));
  assert.equal(menuCalls().length, 2);

  // Writing to the bot does not send the same list again.
  calls.length = 0;
  await say(900, '/id');
  assert.equal(menuCalls().length, 0);
  // A creator has no list of their own, and none is asked for.
  await say(555, 'hello');
  assert.equal(menuCalls().length, 0);
  assert.equal(tierOf(db, 555), 'creator');
});

test('joining the team, changing role and leaving change the list at once', async () => {
  person(301, 'dana');
  calls.length = 0;
  addMember(db, 900, '@dana', 'manager');
  await settle();
  let mine = menuCalls(301);
  assert.equal(mine.length, 1);
  assert.deepEqual(names(mine[0]!.payload.commands), names(privateMenu('team')));

  calls.length = 0;
  changeRole(db, 900, 301, 'owner');
  await settle();
  mine = menuCalls(301);
  assert.deepEqual(names(mine[0]!.payload.commands), names(privateMenu('owner')));

  calls.length = 0;
  changeRole(db, 900, 301, 'viewer');
  await settle();
  assert.deepEqual(names(menuCalls(301)[0]!.payload.commands), ['start', 'admin', 'clear']);

  calls.length = 0;
  removeMember(db, 900, 301);
  await settle();
  mine = menuCalls(301);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.method, 'deleteMyCommands', 'back to the creators\' list');
  assert.deepEqual(mine[0]!.payload.scope, { type: 'chat', chat_id: 301 });

  // And it stays that way: nothing more is sent for them.
  calls.length = 0;
  await say(301, 'hi');
  assert.equal(menuCalls().length, 0);
});

test('someone Telegram does not know yet gets the list when they first write', async () => {
  db.prepare(`INSERT INTO team_members (telegram_id, name, role, created_at) VALUES (302, 'Igor', 'manager', ?)`).run(now());
  strangers.add(302);
  calls.length = 0;
  await configureBot(bot, db); // a restart: tries everyone on the team, does not stop at a refusal
  assert.equal(menuCalls(302).length, 1);
  assert.ok(menuCalls(900).length === 1, 'the owner still got theirs');

  strangers.delete(302);
  calls.length = 0;
  await say(302, '/start');
  assert.equal(menuCalls(302).length, 1);
  assert.deepEqual(names(menuCalls(302)[0]!.payload.commands), names(privateMenu('team')));
});

test('demo mode gives the invited the team list and takes it back', async () => {
  person(401, 'tester');
  db.prepare(`INSERT INTO invites (telegram_id, username, created_at) VALUES (401, 'tester', ?)`).run(now());
  db.prepare(`INSERT INTO invites (telegram_id, username, created_at) VALUES (?, 'made.up.sample', ?)`).run(SAMPLE, now());
  assert.ok(isSampleId(SAMPLE));
  calls.length = 0;
  await say(900, '/demo on');
  assert.deepEqual(names(menuCalls(401)[0]!.payload.commands), names(privateMenu('team')));

  // Sample creators sit on the invite list too. Nothing is asked of Telegram for them.
  assert.equal(menuCalls(SAMPLE).length, 0);

  calls.length = 0;
  await say(900, '/demo off');
  const mine = menuCalls(401);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.method, 'deleteMyCommands');
});
