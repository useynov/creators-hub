import { Bot, GrammyError, type Context } from 'grammy';
import { allowAgeAgain, isAgeRefused, isSetUp, setAccountStatus } from './account.js';
import { audit } from './admin/audit.js';
import { registerAdminBot } from './admin/bot.js';
import { config, isAdmin, settings } from './config.js';
import { now, type DB, type EntryRow, type TaskRow, type UserRow } from './db.js';
import { appButton, copyToAdmins, esc, notifyAdmins } from './notify.js';
import { submissionText } from './pipeline.js';
import {
  addInvite,
  announceTask,
  approveDraft,
  approveEntry,
  checkIn,
  createOffer,
  creatorLine,
  disableInviteLink,
  draftKeyboard,
  findUser,
  grantCoins,
  HubError,
  INVITE_LINK_NOTE,
  INVITE_LINK_PREFIX,
  inviteLinkCode,
  isInvited,
  levelName,
  receiveDraftFile,
  redeemInviteLink,
  removeInvite,
  requestChanges,
  resetInviteLink,
  reviewKeyboard,
  setLevelOverride,
  setViews,
  upsertUser,
} from './service.js';
import { loadSampleData, removeSampleData, sampleStatus } from './sample.js';
import { setMenuApi, syncAllMenus, syncMenu } from './menus.js';
import { startOver, startOverPreview } from './startover.js';
import { demoMode, isManagerOnly, isOwner, isQuiet, isTeam, setDemoMode, setQuiet, teamChats } from './team.js';
import type { Level } from './types.js';

const HTML = { parse_mode: 'HTML' as const };

const ADMIN_HELP = [
  '<b>Team commands</b>',
  '',
  '/invite @username or ID: add creators to the invite list (several at once is fine)',
  '/uninvite @username or ID: remove from the list',
  '/invites: show the invite list',
  '/invitelink: one link that lets in whoever opens it (add "new" to replace it, "off" to turn it off)',
  '/pending: submissions waiting for review',
  '/tasks: tasks and their IDs',
  '/announce task-id: tell the creators in the task\'s audience about it',
  '/views submission-number views: set the views of an approved post',
  '/bonus @username coins reason: add coins by hand (owners only)',
  '/level @username member|pro|partner|auto: set a level by hand (owners only)',
  '/confirm @username or ID: confirm that the Instagram account is theirs (their work can then be paid)',
  '/reject @username or ID reason: we could not confirm the account; the creator gets the reason',
  '/offer @username | campaign | fee | what we need | post by | answer by (owners only)',
  '/admin: a one-time link to sign in to the admin site (in a private chat with me)',
  '/sampledata on|off: load or remove 20 sample creators with work and reports (owners only)',
  '/quiet on|off: stop or resume the team\'s messages coming to you in private',
  '/demo on|off: demo mode, where everyone on the invite list gets the team\'s rights (owners only)',
  '/allowage ID: let someone refused for age answer the question again, after a typo in the date (owners only)',
  '/startover: remove your own creator account, to walk the creator\'s path again from the first screen (owners only, in private)',
  '/clear: empty your private chat with me (Telegram allows the last 48 hours only)',
  '/id: show this chat ID and your user ID',
  '',
  'Type / to see these as a list. Tapping one sends it at once; a command that needs details answers with an example.',
  '',
  'Reply to a creator\'s message to answer them. Scan an event pass with your phone camera to check a creator in.',
].join('\n');

/** /clear: how far back the bot looks (batches of 100 message numbers), and how often one person may sweep. */
const CLEAR_BATCHES = 20;
const CLEAR_COOLDOWN_MS = 20_000;
/** The "Cleared" note removes itself after this long, so the chat ends up empty. */
export const CLEAR_NOTE_MS = Number(process.env.CLEAR_NOTE_MS ?? 6000);

export function createBot(db: DB): Bot {
  const bot = new Bot(config.botToken);

  /** The team: owners (and, in demo mode, everyone invited) anywhere, and everyone inside the team group. */
  const canAdmin = (ctx: Context): boolean =>
    Boolean(ctx.from && (isTeam(db, ctx.from.id) || (config.adminChatId !== null && ctx.chat?.id === config.adminChatId)));

  const notInvited = (ctx: Context) =>
    ctx.reply(
      [
        '🔒 <b>Sorry, you are not on the invite list</b>',
        '',
        `The ${esc(settings.brandName)} is open by invitation only.`,
        '',
        'Were you invited by our team? Check that you opened the bot from the same Telegram account you gave us.',
      ].join('\n'),
      HTML,
    );

  const tooYoung = (ctx: Context) =>
    ctx.reply(
      `The ${esc(settings.brandName)} is open to people aged ${settings.minAge} and over, so we cannot let you in. Thank you for your interest, and all the best!`,
      HTML,
    );

  // A refused action ("already approved", "not enough coins") is an answer, not a crash.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (!(error instanceof HubError)) throw error;
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: error.message, show_alert: true }).catch(() => undefined);
      else await ctx.reply(error.message).catch(() => undefined);
    }
  });

  // Someone on the team sees every command of their role when they type "/". The list follows
  // them when their role changes, and is given the first time they write after joining.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private' && ctx.from) await syncMenu(db, ctx.from.id);
    await next();
  });

  // --- Creators ----------------------------------------------------------

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) return;

    if (ctx.match.startsWith('checkin_') && isTeam(db, ctx.from.id)) {
      const result = checkIn(db, ctx.match.slice('checkin_'.length));
      if (!result) return ctx.reply('This pass is not valid.');
      return ctx.reply(
        result.already
          ? `${esc(result.name)} was already checked in to ${esc(result.event)}.`
          : `✅ <b>${esc(result.name)}</b> is checked in to ${esc(result.event)}.`,
        HTML,
      );
    }

    // The shared invite link: whoever opens it while it is live goes on the invite list.
    if (ctx.match.startsWith(INVITE_LINK_PREFIX) && !redeemInviteLink(db, ctx.from, ctx.match.slice(INVITE_LINK_PREFIX.length))) {
      return ctx.reply('🔒 <b>This invite link is no longer active</b>\n\nAsk our team for a new one.', HTML);
    }

    if (!isInvited(db, ctx.from)) return notInvited(ctx);
    if (isAgeRefused(db, ctx.from.id)) return tooYoung(ctx);
    const user = upsertUser(db, ctx.from);

    await ctx.reply(`<b>Welcome, ${esc(user.first_name)}!</b> You are now part of the ${esc(settings.brandName)}.`, HTML);
    if (config.welcomeVideo) {
      await ctx.replyWithVideo(config.welcomeVideo).catch((error: Error) => console.warn('[bot] welcome video failed:', error.message));
    }
    await ctx.reply(
      [
        'You are now part of our family. Here is what that means:',
        '',
        '<b>• Access to our events, any time</b>',
        '<b>• Free product</b>',
        '<b>• Our latest news first</b>',
      ].join('\n'),
      { ...HTML, reply_markup: appButton('Open Creators Hub', isSetUp(db, user) ? '/' : '/welcome') },
    );
    if (demoMode(db)) {
      await ctx.reply(
        [
          '🧪 <b>Demo mode</b>',
          '',
          'You also have the team\'s rights here, so you can try both sides. What you send as a creator comes back to this chat the way the team sees it, with the review buttons.',
          '',
          '/help lists the team commands.',
        ].join('\n'),
        HTML,
      );
    }
  });

  bot.command('id', (ctx) => ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>\nYour user ID: <code>${ctx.from?.id}</code>`, HTML));

  // /clear empties the private chat with the bot, for anyone, in their own chat only.
  // Telegram's rules set the limits: a bot can delete its own and the person's messages in a
  // private chat, but only those from the last 48 hours, and it cannot read the history. So the
  // bot walks back from this message over the latest message numbers and asks Telegram to delete
  // each batch; numbers that are older, or belong to another chat, are skipped by Telegram.
  const lastClear = new Map<number, number>();
  bot.command('clear', async (ctx) => {
    if (!ctx.from) return;
    if (ctx.chat.type !== 'private') return ctx.reply('/clear works only in a private chat with me.');
    const chatId = ctx.chat.id;
    const top = ctx.msg.message_id;
    // One sweep is up to 20 calls to Telegram: no more than one every 20 seconds per person.
    const recent = Date.now() - (lastClear.get(ctx.from.id) ?? 0) < CLEAR_COOLDOWN_MS;
    lastClear.set(ctx.from.id, Date.now());
    for (let batch = 0; batch < (recent ? 1 : CLEAR_BATCHES); batch += 1) {
      const first = top - batch * 100;
      if (first < 1) break;
      const ids = Array.from({ length: Math.min(100, first) }, (_, index) => first - index);
      await ctx.api.deleteMessages(chatId, ids).catch((error: Error) => console.warn('[bot] /clear batch failed:', error.message));
    }
    const note = await ctx.reply('Cleared. Telegram lets me remove only the last 48 hours, so anything older stays. This note goes away in a few seconds.');
    const timer = setTimeout(() => void ctx.api.deleteMessage(chatId, note.message_id).catch(() => undefined), CLEAR_NOTE_MS);
    timer.unref?.();
  });

  // --- Team commands -----------------------------------------------------

  const admin = bot.filter(canAdmin);

  admin.command('help', (ctx) => ctx.reply(ADMIN_HELP, HTML));

  admin.command('invite', (ctx) => {
    const refs = ctx.match.split(/[\s,]+/).filter(Boolean);
    if (!refs.length) return ctx.reply('Who? For example: /invite @aruzhan.vibes 123456789');
    const lines = refs.map((ref) => `${ref}: ${addInvite(db, ref) === 'added' ? 'invited' : 'already on the list'}`);
    return ctx.reply(`${lines.join('\n')}\n\nThey can now press Start in the bot.`);
  });

  admin.command('uninvite', (ctx) => {
    const ref = ctx.match.trim();
    if (!ref) return ctx.reply('Who? For example: /uninvite @username');
    return ctx.reply(removeInvite(db, ref) ? `${ref} is off the invite list.` : `${ref} was not on the list.`);
  });

  admin.command('invites', (ctx) => {
    const rows = db
      .prepare(
        `SELECT i.telegram_id, i.username, i.note, u.first_name, u.onboarded_at FROM invites i
         LEFT JOIN users u ON u.id = i.telegram_id ORDER BY i.id DESC LIMIT 100`,
      )
      .all() as Array<{
      telegram_id: number | null;
      username: string | null;
      note: string | null;
      first_name: string | null;
      onboarded_at: string | null;
    }>;
    if (!rows.length) return ctx.reply('The invite list is empty. Add someone with /invite @username');
    const lines = rows.map((row) => {
      const who = row.username ? `@${row.username}` : String(row.telegram_id);
      const state = row.onboarded_at ? 'in the Hub' : row.first_name ? 'started the bot' : 'has not opened the bot yet';
      const via = row.note === INVITE_LINK_NOTE ? ', came by the invite link' : '';
      return `${esc(who)}${row.first_name ? ` (${esc(row.first_name)})` : ''}: ${state}${via}`;
    });
    return ctx.reply(lines.join('\n'), HTML);
  });

  admin.command('invitelink', (ctx) => {
    const action = ctx.match.trim().toLowerCase();
    if (action === 'off') {
      return ctx.reply(
        disableInviteLink(db)
          ? 'The invite link is off. Everyone who already came in stays on the list.'
          : 'There was no invite link to turn off.',
      );
    }
    if (action && action !== 'new') return ctx.reply('Use /invitelink, /invitelink new or /invitelink off');

    const code = action === 'new' ? resetInviteLink(db) : (inviteLinkCode(db) ?? resetInviteLink(db));
    return ctx.reply(
      [
        action === 'new' ? '<b>New invite link.</b> The old one no longer lets anyone in.' : '<b>Invite link</b>',
        '',
        `https://t.me/${ctx.me.username}?start=${INVITE_LINK_PREFIX}${code}`,
        '',
        'Whoever opens it and presses Start goes on the invite list. Share it only with people you want in.',
        '',
        '/invitelink new: replace it',
        '/invitelink off: turn it off',
      ].join('\n'),
      { ...HTML, link_preview_options: { is_disabled: true } },
    );
  });

  admin.command('tasks', (ctx) => {
    const rows = db
      .prepare(
        `SELECT t.id, t.title, t.reward, t.active,
                (SELECT COUNT(*) FROM entries e WHERE e.task_id = t.id) AS joined,
                (SELECT COUNT(*) FROM entries e WHERE e.task_id = t.id AND e.status = 'approved') AS approved
         FROM tasks t ORDER BY t.active DESC, t.deadline ASC`,
      )
      .all() as Array<{ id: string; title: string; reward: number; active: number; joined: number; approved: number }>;
    if (!rows.length) return ctx.reply('No tasks yet. Add them to content/seed.json.');
    return ctx.reply(
      rows
        .map(
          (row) =>
            `<code>${esc(row.id)}</code> ${esc(row.title)} (+${row.reward})${row.active ? '' : ' [hidden]'}\n   ${row.joined} joined, ${row.approved} approved`,
        )
        .join('\n'),
      HTML,
    );
  });

  admin.command('pending', async (ctx) => {
    const rows = db
      .prepare(
        `SELECT e.*, t.title, t.reward AS task_reward FROM entries e JOIN tasks t ON t.id = e.task_id
         WHERE e.status IN ('in_review', 'draft_review') ORDER BY COALESCE(e.submitted_at, e.draft_sent_at) ASC LIMIT 15`,
      )
      .all() as Array<EntryRow & Pick<TaskRow, 'title'> & { task_reward: number }>;
    if (!rows.length) return ctx.reply('Nothing is waiting for review.');
    for (const row of rows) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as UserRow;
      const isDraft = row.status === 'draft_review';
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.task_id) as TaskRow;
      await ctx.reply(
        isDraft
          ? [
              `<b>Draft #${row.id}</b>`,
              `Task: ${esc(row.title)} (+${row.task_reward})`,
              `Creator: ${creatorLine(user)}`,
              esc(row.draft_link ?? '(sent as a file)'),
              row.note ? `Note: ${esc(row.note)}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          : submissionText(db, row, task, user, 'Submission'),
        { ...HTML, reply_markup: isDraft ? draftKeyboard(row.id) : reviewKeyboard(row.id), link_preview_options: { is_disabled: true } },
      );
    }
  });

  admin.command('announce', (ctx) => {
    const taskId = ctx.match.trim();
    if (!taskId) return ctx.reply('Which task? See the IDs with /tasks');
    const count = announceTask(db, taskId);
    return ctx.reply(`Sent to ${count} creator${count === 1 ? '' : 's'}.`);
  });

  admin.command('views', (ctx) => {
    const [entryId, views] = ctx.match.replace(/#/g, '').split(/\s+/).map(Number);
    if (!Number.isInteger(entryId) || !Number.isFinite(views)) return ctx.reply('For example: /views 12 4300');
    const result = setViews(db, entryId!, views!);
    return ctx.reply(`Submission #${entryId} (${result.title}) now has ${Math.round(views!).toLocaleString('en-US')} views.`);
  });

  // Coins by hand, levels by hand and paid offers are the owners' decisions, as on the admin site.
  const ownersOnly = (ctx: Context, what: string): string | null =>
    isManagerOnly(db, ctx.from!.id) ? `Only the owners can ${what}. Ask one of them.` : null;

  // Sample creators for looking at the Hub before real ones arrive. See sample.ts.
  admin.command('sampledata', async (ctx) => {
    if (!isOwner(db, ctx.from!.id)) return ctx.reply('Only the owners can load or remove the sample data.');
    const arg = ctx.match.trim().toLowerCase();
    if (arg === 'on') {
      const made = await loadSampleData(db, ctx.from!.id);
      return ctx.reply(
        `Sample data is loaded: ${made.creators} creators, ${made.publications} publications, ${made.tasks} sample tasks.\n` +
          'They are marked "sample" in the admin site and never get messages. Remove them with /sampledata off before real creators join.',
      );
    }
    if (arg === 'off') {
      const removed = await removeSampleData(db);
      return ctx.reply(removed ? `Removed: ${removed} sample creators and everything that belonged to them.` : 'There is no sample data to remove.');
    }
    const status = sampleStatus(db);
    return ctx.reply(
      status.loaded
        ? `Sample data is loaded: ${status.creators} creators. /sampledata off removes it, /sampledata on loads it again with fresh dates.`
        : 'No sample data. /sampledata on loads 20 sample creators with work, measurements, orders and payouts.',
    );
  });

  admin.command('bonus', (ctx) => {
    const refusal = ownersOnly(ctx, 'add coins by hand');
    if (refusal) return ctx.reply(refusal);
    const [ref, amount, ...reason] = ctx.match.trim().split(/\s+/);
    const coins = Number(amount);
    const user = ref ? findUser(db, ref) : undefined;
    if (!user || !Number.isInteger(coins) || coins === 0) return ctx.reply('For example: /bonus @username 20 Top creator of December');
    grantCoins(db, user.id, coins, reason.join(' ') || 'Bonus from the team');
    return ctx.reply(`${coins > 0 ? '+' : ''}${coins} coins for ${user.first_name}.`);
  });

  admin.command('level', (ctx) => {
    const refusal = ownersOnly(ctx, 'set a level by hand');
    if (refusal) return ctx.reply(refusal);
    const [ref, level] = ctx.match.trim().toLowerCase().split(/\s+/);
    const user = ref ? findUser(db, ref) : undefined;
    if (!user || !level || !['member', 'pro', 'partner', 'auto'].includes(level)) {
      return ctx.reply('For example: /level @username pro (or auto to follow the rating again)');
    }
    setLevelOverride(db, user.id, level === 'auto' ? null : (level as Level));
    return ctx.reply(level === 'auto' ? `${user.first_name}'s level follows the rating again.` : `${user.first_name} is now ${levelName(level as Level)}.`);
  });

  admin.command('offer', (ctx) => {
    const refusal = ownersOnly(ctx, 'send a paid offer');
    if (refusal) return ctx.reply(refusal);
    const [ref, ...fields] = ctx.match.split('|').map((part) => part.trim());
    const user = ref ? findUser(db, ref) : undefined;
    if (!user || fields.length !== 5 || fields.some((field) => !field)) {
      return ctx.reply('For example:\n/offer @username | Summer campaign | 150 000 | 2 reels | 20 June | 10 June');
    }
    createOffer(db, user.id, fields as [string, string, string, string, string]);
    return ctx.reply(`Offer sent to ${user.first_name}.`);
  });

  admin.command('quiet', (ctx) => {
    const action = ctx.match.trim().toLowerCase();
    if (action !== 'on' && action !== 'off') {
      return ctx.reply(`The team's messages are ${isQuiet(db, ctx.from!.id) ? 'off' : 'on'} for you. Use /quiet on or /quiet off`);
    }
    setQuiet(db, ctx.from!.id, action === 'on');
    return ctx.reply(
      action === 'on'
        ? 'Done. The team\'s messages will no longer come to you in private. /quiet off brings them back.'
        : 'Done. You get the team\'s messages again.',
    );
  });

  admin.command('demo', (ctx) => {
    const action = ctx.match.trim().toLowerCase();
    if (action !== 'on' && action !== 'off') {
      return ctx.reply(`Demo mode is ${demoMode(db) ? 'on' : 'off'}. Use /demo on or /demo off`);
    }
    if (!isAdmin(ctx.from!.id)) return ctx.reply('Only the owners can switch demo mode.');
    setDemoMode(db, action === 'on');
    // Demo mode changes who has the team's commands, so their "/" lists change with it.
    void syncAllMenus(db);
    return ctx.reply(
      action === 'on'
        ? 'Demo mode is on. Everyone on the invite list now has the team\'s rights and gets the team\'s messages. Turn it off before real creators join: /demo off'
        : 'Demo mode is off. Only the owners and the team group have the team\'s rights.',
    );
  });

  // Undo of an age refusal, for an adult who mistyped their date of birth. Owners only.
  admin.command('allowage', (ctx) => {
    if (!isOwner(db, ctx.from!.id)) return ctx.reply('Only the owners can lift an age refusal.');
    const id = Number(ctx.match.trim());
    if (!Number.isInteger(id) || id <= 0) return ctx.reply('Send the Telegram ID, for example: /allowage 123456789');
    return ctx.reply(
      allowAgeAgain(db, id)
        ? `Done. ${id} can open the Hub and answer the age question again.`
        : `${id} was not refused for age, so there was nothing to lift.`,
    );
  });

  // An owner's own creator account, wiped, to see the creator's path again from the first screen.
  // Only ever the sender's own account, and only after a second message that says yes.
  admin.command('startover', async (ctx) => {
    const id = ctx.from!.id;
    if (ctx.chat.type !== 'private') return ctx.reply('Send /startover to me in a private chat.');
    if (!isOwner(db, id)) return ctx.reply('Only the owners can start over.');
    const found = startOverPreview(db, id);
    if (!found) return ctx.reply('You have no creator account here. Press /start to come in as a new creator.');

    const things = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
    if (ctx.match.trim().toLowerCase() !== 'yes') {
      return ctx.reply(
        [
          '<b>Start over as a new creator?</b>',
          '',
          'This removes your own creator account for good:',
          `• ${things(found.tasks, 'task', 'tasks')} you joined, with ${things(found.publications, 'publication', 'publications')} and their numbers`,
          `• ${things(found.coins, 'coin', 'coins')} and their history`,
          `• ${things(found.orders, 'order', 'orders')}, ${things(found.cashouts, 'payout request', 'payout requests')}, ${things(found.rsvps, 'event RSVP', 'event RSVPs')}`,
          '• your Instagram account, level and personal details',
          '',
          'Your team role, the tasks and shop items you made, and everything about other creators stay as they are.',
          '',
          'It cannot be undone. To go ahead, send: <code>/startover yes</code>',
        ].join('\n'),
        HTML,
      );
    }

    await startOver(db, id);
    audit(db, id, 'creator.startover', id);
    return ctx.reply(
      [
        '<b>Done. Your creator account is removed.</b>',
        '',
        'You are still an owner, and the admin site works as before.',
        '',
        'Press /start to come in as a new creator: the welcome, your age, your Instagram account. Your account will then wait for the team: confirm it yourself with /confirm and your Telegram ID, or on the admin site.',
      ].join('\n'),
      HTML,
    );
  });

  admin.command('cancel', (ctx) => {
    db.prepare('DELETE FROM admin_pending WHERE admin_id = ?').run(ctx.from!.id);
    return ctx.reply('Cancelled.');
  });

  // --- Review buttons ----------------------------------------------------

  admin.callbackQuery(/^(ap|da|nc):(\d+)(?::(\d))?$/, async (ctx) => {
    const [, action, id, score] = ctx.match;
    const entryId = Number(id);
    const reviewer = esc(ctx.from.first_name);
    const original = ctx.callbackQuery.message;
    const stamp = async (line: string) => {
      if (!original || !('text' in original) || !original.text) return;
      await ctx
        .editMessageText(`${esc(original.text)}\n\n${line}`, { ...HTML, link_preview_options: { is_disabled: true } })
        .catch(() => undefined);
    };

    if (action === 'ap') {
      let result: { title: string; reward: number };
      try {
        result = approveEntry(db, entryId, Number(score));
      } catch (error) {
        if (!(error instanceof HubError) || error.code !== 'account_not_confirmed') throw error;
        return ctx.answerCallbackQuery({ text: notConfirmedHelp(entryId), show_alert: true });
      }
      await ctx.answerCallbackQuery({ text: `Approved. +${result.reward} coins sent.` });
      await stamp(`✅ Approved by ${reviewer}, score ${score} of 5`);
    } else if (action === 'da') {
      approveDraft(db, entryId);
      await ctx.answerCallbackQuery({ text: 'Draft approved.' });
      await stamp(`✅ Draft approved by ${reviewer}`);
    } else {
      db.prepare('INSERT OR REPLACE INTO admin_pending (admin_id, entry_id, created_at) VALUES (?, ?, ?)').run(ctx.from.id, entryId, now());
      await ctx.answerCallbackQuery();
      await ctx.reply(`What should the creator fix in #${entryId}? Reply to this message with your comment. /cancel to drop it.`, {
        reply_markup: { force_reply: true, selective: true },
        reply_parameters: original ? { message_id: original.message_id } : undefined,
      });
    }
  });

  // --- Account confirmation ------------------------------------------------

  /** What the reviewer should do when a work cannot be approved because the account is not confirmed. */
  const notConfirmedHelp = (entryId: number): string => {
    const row = db.prepare('SELECT u.id, u.account_status FROM entries e JOIN users u ON u.id = e.user_id WHERE e.id = ?').get(entryId) as
      | { id: number; account_status: string }
      | undefined;
    if (row?.account_status === 'rejected') {
      return `Not paid: this creator's Instagram account was rejected. If that was a mistake, send /confirm ${row.id}, then approve again.`;
    }
    return `Not paid yet: the creator's Instagram account is not confirmed. Press Confirm under their "New account to confirm" message, or send /confirm ${row?.id ?? 'ID'}, then approve again.`;
  };

  /** The creator behind a button, or a refusal the presser can read. */
  const accountOwner = (userId: number): UserRow => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!user?.instagram) throw new HubError('user_not_found', 'This creator has no connected account.', 404);
    return user;
  };

  admin.callbackQuery(/^(ac|ar):(\d+)$/, async (ctx) => {
    const [, action, id] = ctx.match;
    const user = accountOwner(Number(id));
    const decider = esc(ctx.from.first_name);
    const original = ctx.callbackQuery.message;
    const text = original && 'text' in original ? original.text : undefined;

    if (action === 'ac') {
      if (user.account_status === 'confirmed') {
        return ctx.answerCallbackQuery({ text: 'This account is already confirmed.', show_alert: true });
      }
      setAccountStatus(db, user.id, 'confirmed', ctx.from.id);
      await ctx.answerCallbackQuery({ text: 'Account confirmed.' });
      if (text) {
        await ctx
          .editMessageText(`${esc(text)}\n\n✅ Account confirmed by ${decider}`, { ...HTML, link_preview_options: { is_disabled: true } })
          .catch(() => undefined);
      }
      return;
    }

    // Reject: the reason comes as the next reply, like "Needs changes".
    db.prepare(
      `INSERT OR REPLACE INTO admin_pending (admin_id, entry_id, created_at, kind, chat_id, message_id, message_text)
       VALUES (?, ?, ?, 'account', ?, ?, ?)`,
    ).run(ctx.from.id, user.id, now(), original?.chat.id ?? null, original?.message_id ?? null, text?.slice(0, 3500) ?? null);
    await ctx.answerCallbackQuery();
    await ctx.reply(`Why can we not confirm @${user.instagram}? Reply to this message with the reason, the creator will see it. /cancel to drop it.`, {
      reply_markup: { force_reply: true, selective: true },
      reply_parameters: original ? { message_id: original.message_id } : undefined,
    });
  });

  admin.command('confirm', (ctx) => {
    const user = ctx.match.trim() ? findUser(db, ctx.match.trim().split(/\s+/)[0]!) : undefined;
    if (!user?.instagram) return ctx.reply('Whose account? For example: /confirm @username or /confirm 123456789');
    if (user.account_status === 'confirmed') return ctx.reply(`@${user.instagram} is already confirmed.`);
    setAccountStatus(db, user.id, 'confirmed', ctx.from!.id);
    return ctx.reply(`✅ @${user.instagram} (${user.first_name}) is confirmed. Their work can be approved now.`);
  });

  admin.command('reject', (ctx) => {
    const [ref, ...reason] = ctx.match.trim().split(/\s+/);
    const user = ref ? findUser(db, ref) : undefined;
    const note = reason.join(' ').trim();
    if (!user?.instagram || !note) return ctx.reply('Whose account, and why? For example: /reject @username The profile belongs to someone else');
    setAccountStatus(db, user.id, 'rejected', ctx.from!.id, note);
    return ctx.reply(`@${user.instagram} (${user.first_name}) is rejected. They got your reason and can connect another account.`);
  });

  // --- Admin panel -------------------------------------------------------

  registerAdminBot(bot, db);

  // --- Messages ----------------------------------------------------------

  bot.on('message', async (ctx) => {
    const from = ctx.from;
    const message = ctx.message;
    const isPrivate = ctx.chat.type === 'private';
    const body = message.text ?? message.caption ?? '';

    if (canAdmin(ctx)) {
      // 1. A comment for "Needs changes", or the reason for rejecting an account.
      const pending = db.prepare('SELECT * FROM admin_pending WHERE admin_id = ?').get(from.id) as
        | { entry_id: number; kind: string; chat_id: number | null; message_id: number | null; message_text: string | null }
        | undefined;
      const repliesToBot = message.reply_to_message?.from?.id === ctx.me.id;
      if (pending && message.text && (isPrivate || repliesToBot)) {
        db.prepare('DELETE FROM admin_pending WHERE admin_id = ?').run(from.id);
        if (pending.kind === 'account') {
          const user = accountOwner(pending.entry_id);
          setAccountStatus(db, user.id, 'rejected', from.id, message.text);
          if (pending.chat_id && pending.message_id && pending.message_text) {
            await ctx.api
              .editMessageText(pending.chat_id, pending.message_id, `${esc(pending.message_text)}\n\n❌ Account rejected by ${esc(from.first_name)}`, {
                ...HTML,
                link_preview_options: { is_disabled: true },
              })
              .catch(() => undefined);
          }
          return ctx.reply(`Sent to the creator: @${user.instagram} could not be confirmed.`);
        }
        const title = requestChanges(db, pending.entry_id, message.text);
        return ctx.reply(`Sent to the creator: “${title}” needs changes.`);
      }

      // 2. An answer to a creator's question.
      const replyTo = message.reply_to_message?.message_id;
      const thread = replyTo
        ? (db.prepare('SELECT user_id FROM support_threads WHERE chat_id = ? AND message_id = ?').get(ctx.chat.id, replyTo) as
            | { user_id: number }
            | undefined)
        : undefined;
      if (thread) {
        try {
          await ctx.api.copyMessage(thread.user_id, ctx.chat.id, message.message_id);
          return await ctx.react('👍').catch(() => ctx.reply('Sent.'));
        } catch (error) {
          return ctx.reply(`Could not deliver: ${(error as Error).message}`);
        }
      }
    }

    if (!isPrivate) return;
    if (!isInvited(db, from)) return notInvited(ctx);
    if (isAgeRefused(db, from.id)) return tooYoung(ctx);
    const user = upsertUser(db, from);

    // 3. A draft file we asked for.
    const file = message.video ?? message.document ?? message.animation ?? message.video_note;
    if (file && user.pending) {
      await copyToAdmins(db, ctx.chat.id, message.message_id);
      const accepted = receiveDraftFile(db, user, file.file_id);
      if (accepted) {
        const wait = settings.reviewTime ? ` The team usually answers within ${settings.reviewTime}.` : '';
        return ctx.reply(`Got your draft for <b>${esc(accepted.task.title)}</b>.${wait} Do not post it yet: wait for “Approved”.`, {
          ...HTML,
          reply_markup: appButton('See the status', `/tasks/${accepted.task.id}`),
        });
      }
    }

    // 4. A command we do not know: point back to the app.
    if (message.text?.startsWith('/')) {
      return ctx.reply('Everything lives in the Hub. Open it with the button below, or just write here to reach the team.', {
        reply_markup: appButton('Open Creators Hub', isSetUp(db, user) ? '/' : '/welcome'),
      });
    }

    // 5. Anything else is a message for the team.
    if (!body && !file && !message.photo && !message.voice) return;
    if (!teamChats(db).length) return ctx.reply('The team chat is not set up yet. Please try again later.');
    if (!message.text) await copyToAdmins(db, ctx.chat.id, message.message_id);
    const sent = await notifyAdmins(
      db,
      `💬 ${creatorLine(user)} writes:\n\n${esc(body || '(attachment above)')}\n\n<i>Reply to this message to answer.</i>`,
    );
    const remember = db.prepare('INSERT OR REPLACE INTO support_threads (chat_id, message_id, user_id) VALUES (?, ?, ?)');
    for (const copy of sent) remember.run(copy.chatId, copy.messageId, user.id);
    return ctx.reply('Passed to the team. We will answer right here.');
  });

  bot.catch(({ error }) => {
    if (error instanceof GrammyError) console.error('[bot] Telegram refused a call:', error.description);
    else console.error('[bot] handler failed:', error);
  });

  return bot;
}

/** One-time bot setup: the command lists (see menus.ts) and the "Open app" menu button. */
export async function configureBot(bot: Bot, db: DB): Promise<void> {
  setMenuApi(bot.api);
  await syncAllMenus(db);
  if (config.webappUrl.startsWith('https://')) {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Open app', web_app: { url: config.webappUrl } },
    });
  } else {
    console.warn('[bot] WEBAPP_URL is not an https address: the bot will not show buttons that open the mini app.');
  }
}
