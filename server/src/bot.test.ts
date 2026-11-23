import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
delete process.env.ADMIN_CHAT_ID;
delete process.env.WELCOME_VIDEO;

const { createBot } = await import('./bot.js');
const { openDb, syncContent } = await import('./db.js');
const { setApi } = await import('./notify.js');
const service = await import('./service.js');
const account = await import('./account.js');
const { idle } = await import('./background.js');

const db = openDb(':memory:');
syncContent(db);
const bot = createBot(db);

// Telegram is replaced by a recorder: every outgoing call is kept and answered with a plausible result.
interface Call {
  method: string;
  payload: Record<string, any>;
}
const calls: Call[] = [];
let ids = 1000;
bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload: payload as Record<string, any> });
  const result = method === 'sendMessage' || method === 'copyMessage' || method === 'sendVideo' ? { message_id: ++ids, date: 0, chat: { id: (payload as any).chat_id, type: 'private' } } : true;
  return { ok: true, result } as any;
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'Hub', username: 'test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any;
setApi(bot.api);

const admin = { id: 900, first_name: 'Dana', username: 'dana_team' };
const creator = { id: 42, first_name: 'Aruzhan', username: 'aruzhan' };
const stranger = { id: 77, first_name: 'Nobody' };

let updateId = 0;
async function say(from: { id: number; first_name: string; username?: string }, text: string, extra: Record<string, unknown> = {}): Promise<Call[]> {
  calls.length = 0;
  const command = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0]!.length }] : undefined;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: ++ids, date: 0, chat: { id: from.id, type: 'private', first_name: from.first_name }, from: { ...from, is_bot: false }, text, entities: command, ...extra },
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return [...calls];
}
async function press(from: typeof admin, data: string, messageText: string): Promise<Call[]> {
  calls.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    callback_query: { id: String(updateId), from: { ...from, is_bot: false }, chat_instance: '1', data, message: { message_id: ++ids, date: 0, chat: { id: from.id, type: 'private' }, text: messageText } },
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return [...calls];
}
const texts = (list: Call[], chatId: number): string[] => list.filter((call) => call.method === 'sendMessage' && call.payload.chat_id === chatId).map((call) => call.payload.text as string);

test('/start: a stranger is turned away, team commands are closed to them', async () => {
  const start = await say(stranger, '/start');
  assert.match(texts(start, 77)[0]!, /not on the invite list/);
  await say(stranger, '/invite @nobody');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invites').get()!.n, 0);
});

test('/invite then /start: welcome and one button that opens the mini app', async () => {
  const invited = await say(admin, '/invite @aruzhan');
  assert.match(texts(invited, 900)[0]!, /@aruzhan: invited/);

  const start = await say(creator, '/start');
  const sent = start.filter((call) => call.method === 'sendMessage');
  assert.match(sent[0]!.payload.text, /Welcome, Aruzhan!/);
  const button = sent[1]!.payload.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, 'Open Creators Hub');
  assert.equal(button.web_app.url, 'https://hub.example/welcome');
});

test('review in the bot: submission reaches the team, comment and approval reach the creator', async () => {
  const user = service.getUser(db, 42)!;
  calls.length = 0;
  await service.submitLinks(db, user, 'caravan-shoot', { links: ['https://instagram.com/reel/abc'] });
  await idle();
  const toTeam = calls.find((call) => call.payload.chat_id === 900)!;
  assert.match(toTeam.payload.text, /New submission #1/);
  assert.equal(toTeam.payload.reply_markup.inline_keyboard[1][0].callback_data, 'nc:1');

  // "Needs changes" asks for a comment, and the next message from that admin is the comment.
  const asked = await press(admin, 'nc:1', toTeam.payload.text);
  assert.match(texts(asked, 900)[0]!, /What should the creator fix/);
  const commented = await say(admin, 'The truck is hard to see.');
  assert.match(texts(commented, 42)[0]!, /Needs changes/);
  assert.equal(commented.find((call) => call.payload.chat_id === 42)!.payload.reply_markup.inline_keyboard[0][0].web_app.url, 'https://hub.example/tasks/caravan-shoot');
  assert.equal(service.oneTask(db, 42, 'caravan-shoot').entry?.comment, 'The truck is hard to see.');

  await service.submitLinks(db, user, 'caravan-shoot', { links: ['https://instagram.com/reel/def'] });
  await idle();

  // The account is not confirmed yet: the reviewer is told why, and no coins move.
  const early = await press(admin, 'ap:1:5', 'Resubmitted #1');
  const alert = early.find((call) => call.method === 'answerCallbackQuery')!;
  assert.equal(alert.payload.show_alert, true);
  assert.match(alert.payload.text, /not confirmed yet/);
  assert.equal(service.balanceOf(db, 42), 0);

  account.setAccountStatus(db, 42, 'confirmed', 900);
  const approved = await press(admin, 'ap:1:5', 'Resubmitted #1');
  assert.match(texts(approved, 42)[0]!, /\+5 coins are in your wallet/);
  assert.ok(approved.some((call) => call.method === 'editMessageText' && /Approved by Dana, score 5/.test(call.payload.text)));
  assert.equal(service.balanceOf(db, 42), 5);

  // A second press on a stale button is refused, coins are not paid twice.
  const again = await press(admin, 'ap:1:5', 'Resubmitted #1');
  assert.ok(again.some((call) => call.method === 'answerCallbackQuery' && call.payload.show_alert));
  assert.equal(service.balanceOf(db, 42), 5);
});

test('a creator cannot press review buttons', async () => {
  service.submitDraftLink(db, service.getUser(db, 42)!, 'new-year-table-reel', { links: ['https://drive.google.com/x'] });
  await press(creator as any, 'da:2', 'Draft #2');
  assert.equal(service.oneTask(db, 42, 'new-year-table-reel').entry?.status, 'draft_review');
});

test('questions go to the team, and a reply comes back to the creator', async () => {
  const asked = await say(creator, 'Can I post two reels?');
  const forwarded = asked.find((call) => call.method === 'sendMessage' && call.payload.chat_id === 900)!;
  assert.match(forwarded.payload.text, /Can I post two reels\?/);
  assert.match(texts(asked, 42)[0]!, /Passed to the team/);

  const threadMessage = db.prepare('SELECT message_id FROM support_threads WHERE user_id = 42').get() as { message_id: number };
  const replied = await say(admin, 'Yes, both count.', { reply_to_message: { message_id: threadMessage.message_id, date: 0, chat: { id: 900, type: 'private' }, from: { id: 1, is_bot: true, first_name: 'Hub' } } });
  const copy = replied.find((call) => call.method === 'copyMessage')!;
  assert.equal(copy.payload.chat_id, 42);
});

test('draft upload: the file sent to the bot becomes the draft', async () => {
  const user = service.getUser(db, 42)!;
  db.prepare(`UPDATE entries SET status = 'draft_changes' WHERE id = 2`).run();
  service.requestDraftUpload(db, user, 'new-year-table-reel');
  const sent = await say(creator, '', { text: undefined, video: { file_id: 'VIDEO123', file_unique_id: 'u', width: 1, height: 1, duration: 1 } });
  assert.ok(sent.some((call) => call.method === 'copyMessage' && call.payload.chat_id === 900));
  assert.match(texts(sent, 42)[0]!, /Got your draft/);
  const row = db.prepare('SELECT status, draft_file_id FROM entries WHERE id = 2').get() as { status: string; draft_file_id: string };
  assert.deepEqual({ ...row }, { status: 'draft_review', draft_file_id: 'VIDEO123' });
});

test('event pass: only the team can check a creator in', async () => {
  service.rsvp(db, service.getUser(db, 42)!, 'new-year-caravan');
  const { code } = db.prepare('SELECT code FROM rsvps WHERE user_id = 42').get() as { code: string };
  await say(creator, `/start checkin_${code}`);
  assert.equal((db.prepare('SELECT checked_in_at FROM rsvps WHERE user_id = 42').get() as any).checked_in_at, null);
  const scanned = await say(admin, `/start checkin_${code}`);
  assert.match(texts(scanned, 900)[0]!, /Aruzhan<\/b> is checked in/);
});

test('/invitelink: the shared link lets in whoever opens it, until it is replaced or turned off', async () => {
  const igor = { id: 78, first_name: 'Igor' };
  const late = { id: 79, first_name: 'Late' };
  const linkIn = (list: Call[]): string => texts(list, 900)[0]!.match(/https:\/\/t\.me\/test_bot\?start=(join_[\w-]+)/)![1]!;

  // No link yet: a made-up code opens nothing, and only the team can make a link.
  const guess = await say(igor, '/start join_guess');
  assert.match(texts(guess, 78)[0]!, /no longer active/);
  await say(igor, '/invitelink');
  assert.equal(service.inviteLinkCode(db), null);
  assert.equal(service.isInvited(db, igor), false);

  // The team asks for the link. Asking again shows the same one.
  const payload = linkIn(await say(admin, '/invitelink'));
  assert.equal(linkIn(await say(admin, '/invitelink')), payload);

  // Opening it is enough: welcome, and the account is on the list from then on.
  const joined = await say(igor, `/start ${payload}`);
  assert.match(texts(joined, 78)[0]!, /Welcome, Igor!/);
  assert.equal((db.prepare('SELECT note FROM invites WHERE telegram_id = 78').get() as { note: string }).note, 'invite link');
  assert.match(texts(await say(igor, '/start'), 78)[0]!, /Welcome, Igor!/);
  assert.match(texts(await say(admin, '/invites'), 900)[0]!, /78 \(Igor\): started the bot, came by the invite link/);

  // Someone already on the list is not added twice.
  await say(creator, `/start ${payload}`);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM invites WHERE telegram_id = 42 OR username = ?').get('aruzhan') as { n: number }).n, 1);

  // A replaced link: the old one stops working, people already in stay in.
  const fresh = linkIn(await say(admin, '/invitelink new'));
  assert.notEqual(fresh, payload);
  assert.match(texts(await say(late, `/start ${payload}`), 79)[0]!, /no longer active/);
  assert.equal(service.isInvited(db, late), false);
  assert.equal(service.isInvited(db, igor), true);

  // Turned off: no link opens the door, a plain /start is still refused.
  assert.match(texts(await say(admin, '/invitelink off'), 900)[0]!, /invite link is off/);
  assert.match(texts(await say(late, `/start ${fresh}`), 79)[0]!, /no longer active/);
  assert.match(texts(await say(late, '/start'), 79)[0]!, /not on the invite list/);
  assert.equal(service.isInvited(db, igor), true);
});

test('demo mode: everyone on the invite list gets the team side, and /quiet stops the messages', async () => {
  const team = await import('./team.js');
  const igor = { id: 78, first_name: 'Igor' };
  const outsider = { id: 80, first_name: 'Outsider' };
  const toChat = (list: Call[], chatId: number): Call[] => list.filter((call) => call.method === 'sendMessage' && call.payload.chat_id === chatId);

  // Off by default: an invited creator has no team commands and cannot switch the mode.
  await say(igor, '/demo on');
  assert.equal(team.demoMode(db), false);
  assert.doesNotMatch(texts(await say(igor, '/help'), 78)[0]!, /Team commands/);

  // The owner turns it on. Invited people become the team, strangers do not.
  assert.match(texts(await say(admin, '/demo on'), 900)[0]!, /Demo mode is on/);
  assert.match(texts(await say(igor, '/help'), 78)[0]!, /Team commands/);
  assert.match(texts(await say(igor, '/start'), 78).at(-1)!, /Demo mode/);
  assert.match(texts(await say(outsider, '/help'), 80)[0]!, /not on the invite list/);
  assert.match(texts(await say(igor, '/demo off'), 78)[0]!, /Only the owners/);
  assert.equal(team.demoMode(db), true);

  // A tester's own submission comes back to them with the review buttons, and they approve it themselves.
  calls.length = 0;
  account.setAccountStatus(db, 78, 'confirmed', 900);
  calls.length = 0;
  await service.submitLinks(db, service.getUser(db, 78)!, 'caravan-shoot', { links: ['https://instagram.com/reel/igor'] });
  await idle();
  const review = toChat([...calls], 78).find((call) => /New submission #\d+/.test(call.payload.text))!;
  const entryId = Number(review.payload.text.match(/New submission #(\d+)/)![1]);
  assert.equal(review.payload.reply_markup.inline_keyboard[1][0].callback_data, `nc:${entryId}`);
  assert.ok(toChat([...calls], 900).length > 0, 'the owner still gets the team messages until they go quiet');
  const approved = await press(igor as any, `ap:${entryId}:4`, review.payload.text);
  assert.match(texts(approved, 78)[0]!, /\+5 coins are in your wallet/);
  assert.equal(service.balanceOf(db, 78), 5);

  // The owner goes quiet: nothing more comes to them, testers still get everything.
  assert.match(texts(await say(admin, '/quiet on'), 900)[0]!, /no longer come to you/);
  calls.length = 0;
  service.rsvp(db, service.getUser(db, 78)!, 'new-year-caravan');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(toChat([...calls], 900).length, 0);
  assert.ok(toChat([...calls], 78).some((call) => /is coming to/.test(call.payload.text)));
  assert.deepEqual(team.teamChats(db).sort(), [42, 78]);

  // Back to normal: quiet off, demo off, the invited creator is a creator again.
  await say(admin, '/quiet off');
  assert.match(texts(await say(admin, '/demo off'), 900)[0]!, /Demo mode is off/);
  assert.deepEqual(team.teamChats(db), [900]);
  assert.doesNotMatch(texts(await say(igor, '/help'), 78)[0]!, /Team commands/);
  assert.doesNotMatch(texts(await say(igor, '/start'), 78).join('\n'), /Demo mode/);
});

test('/allowage: an age refusal stays until an owner lifts it, then the person can try again', async () => {
  const typo = { id: 81, first_name: 'Typo' };
  const team = await import('./team.js');
  service.addInvite(db, '81');
  db.prepare(`INSERT INTO age_refusals (telegram_id, created_at) VALUES (81, '2026-11-23T00:00:00.000Z')`).run();

  // Refused: the bot says so kindly, nothing else opens, and the refusal does not wear off.
  assert.match(texts(await say(typo, '/start'), 81)[0]!, /aged 18 and over/);
  assert.match(texts(await say(typo, 'Hello?'), 81)[0]!, /aged 18 and over/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 81').get()!.n, 0, 'no user row comes back');

  // Only an owner can lift it: not a creator, not a demo-mode tester.
  await say(creator, '/allowage 81');
  team.setDemoMode(db, true);
  assert.match(texts(await say({ id: 78, first_name: 'Igor' }, '/allowage 81'), 78)[0]!, /Only the owners/);
  team.setDemoMode(db, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM age_refusals WHERE telegram_id = 81').get()!.n, 1);

  assert.match(texts(await say(admin, '/allowage someone'), 900)[0]!, /for example: \/allowage 123456789/);
  assert.match(texts(await say(admin, '/allowage 81'), 900)[0]!, /Done\. 81 can open the Hub and answer the age question again/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM age_refusals WHERE telegram_id = 81').get()!.n, 0);
  assert.match(texts(await say(admin, '/allowage 81'), 900)[0]!, /was not refused for age/);
  assert.match(texts(await say(typo, '/start'), 81)[0]!, /Welcome, Typo!/);
  assert.match(texts(await say(admin, '/help'), 900)[0]!, /\/allowage ID/);
});

test('account buttons: the team confirms or rejects in the bot, with a stamp; creators cannot; demo testers can', async () => {
  const team = await import('./team.js');
  const { idle } = await import('./background.js');
  const people = [
    { id: 85, first_name: 'Saule', username: 'saule' },
    { id: 86, first_name: 'Erlan', username: 'erlan' },
    { id: 87, first_name: 'Gulnar', username: 'gulnar' },
  ];
  const connect = async (person: (typeof people)[number], handle: string): Promise<Call> => {
    service.addInvite(db, String(person.id));
    service.upsertUser(db, person);
    account.startLookup(db, service.getUser(db, person.id)!, { birthDate: '1996-04-04', instagram: handle });
    await idle();
    calls.length = 0;
    account.confirmLookup(db, service.getUser(db, person.id)!, { city: 'Almaty' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return calls.find((call) => call.method === 'sendMessage' && call.payload.chat_id === 900 && /New account to confirm/.test(call.payload.text))!;
  };

  // The team's message carries the two buttons.
  const notice = await connect(people[0]!, 'saule.cooks');
  assert.deepEqual(
    notice.payload.reply_markup.inline_keyboard[0].map((button: { text: string; callback_data: string }) => [button.text, button.callback_data]),
    [['Confirm', 'ac:85'], ['Reject', 'ar:85']],
  );

  // A creator pressing them changes nothing.
  await press(creator as any, 'ac:85', notice.payload.text);
  assert.equal(service.getUser(db, 85)!.account_status, 'pending');

  // The team confirms: status, who decided, the stamp, and the creator's message.
  const confirmed = await press(admin, 'ac:85', notice.payload.text);
  const saule = service.getUser(db, 85)!;
  assert.deepEqual([saule.account_status, saule.account_reviewed_by], ['confirmed', 900]);
  assert.ok(confirmed.some((call) => call.method === 'editMessageText' && /✅ Account confirmed by Dana/.test(call.payload.text)));
  assert.match(texts(confirmed, 85)[0]!, /Your account is confirmed/);
  const again = await press(admin, 'ac:85', notice.payload.text);
  assert.match(again.find((call) => call.method === 'answerCallbackQuery')!.payload.text, /already confirmed/);

  // Reject asks for the reason; /cancel drops it; the reply rejects with the note and stamps the message.
  const second = await connect(people[1]!, 'erlan.not.mine');
  const asked = await press(admin, 'ar:86', second.payload.text);
  assert.match(texts(asked, 900)[0]!, /Why can we not confirm @erlan\.not\.mine\?/);
  await say(admin, '/cancel');
  await say(admin, 'Random chat after cancel');
  assert.equal(service.getUser(db, 86)!.account_status, 'pending');
  await press(admin, 'ar:86', second.payload.text);
  const rejected = await say(admin, 'The profile belongs to a café, not to you.');
  const erlan = service.getUser(db, 86)!;
  assert.deepEqual([erlan.account_status, erlan.account_note, erlan.account_reviewed_by], ['rejected', 'The profile belongs to a café, not to you.', 900]);
  assert.match(texts(rejected, 86)[0]!, /could not confirm your account[\s\S]*belongs to a café/);
  assert.equal(rejected.find((call) => call.payload.chat_id === 86)!.payload.reply_markup.inline_keyboard[0][0].web_app.url, 'https://hub.example/profile/instagram');
  assert.ok(rejected.some((call) => call.method === 'editMessageText' && /❌ Account rejected by Dana/.test(call.payload.text)));
  assert.match(texts(rejected, 900)[0]!, /could not be confirmed/);

  // The commands do the same.
  assert.match(texts(await say(admin, '/confirm @erlan'), 900)[0]!, /erlan\.not\.mine \(Erlan\) is confirmed/);
  assert.equal(service.getUser(db, 86)!.account_status, 'confirmed');
  assert.match(texts(await say(admin, '/reject 86'), 900)[0]!, /Whose account, and why\?/);
  assert.match(texts(await say(admin, '/reject 86 Wrong person'), 900)[0]!, /is rejected/);
  assert.equal(service.getUser(db, 86)!.account_note, 'Wrong person');
  await say(creator, '/confirm 86');
  assert.equal(service.getUser(db, 86)!.account_status, 'rejected', 'a creator cannot use the commands');

  // An approval refused for an unconfirmed account tells the reviewer what to do next.
  const third = await connect(people[2]!, 'gulnar.eats');
  await service.submitLinks(db, service.getUser(db, 87)!, 'new-year-post', { links: ['https://www.instagram.com/gulnar.eats/p/GUL1/'] });
  await idle();
  const entryId = (db.prepare(`SELECT id FROM entries WHERE user_id = 87`).get() as { id: number }).id;
  const refused = await press(admin, `ap:${entryId}:5`, 'New submission');
  const alert = refused.find((call) => call.method === 'answerCallbackQuery')!;
  assert.equal(alert.payload.show_alert, true);
  assert.match(alert.payload.text, /Press Confirm under their "New account to confirm" message, or send \/confirm 87, then approve again/);
  assert.equal(service.balanceOf(db, 87), 0);

  // In demo mode a tester (no admin site) confirms with the button, then approves their test work.
  team.setDemoMode(db, true);
  const tester = { id: 78, first_name: 'Igor' };
  await press(tester as any, 'ac:87', third.payload.text);
  assert.equal(service.getUser(db, 87)!.account_status, 'confirmed');
  const paid = await press(tester as any, `ap:${entryId}:5`, 'New submission');
  assert.match(texts(paid, 87)[0]!, /coins are in your wallet/);
  team.setDemoMode(db, false);
});
