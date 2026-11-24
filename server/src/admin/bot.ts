// Bot commands that belong to the admin site. Registered before the bot's catch-all message handler.
//
// /admin, in a private chat with the bot, gives a team member a one-time link to the admin
// site. Only ADMIN_IDS and the team_members table count as the team here: demo mode and the
// team group chat never open the admin site.

import { InlineKeyboard, type Bot } from 'grammy';
import { config } from '../config.js';
import type { DB } from '../db.js';
import { esc } from '../notify.js';
import { issueLoginToken, LOGIN_TTL_MS, loginUrl, RateLimiter, roleOf } from './auth.js';

let usernameOf: () => string | null = () => null;

/** The bot's @username once it has started, for links on the admin site. null without a bot. */
export const adminBotUsername = (): string | null => usernameOf();

/** At most this many login links per person in ten minutes. */
const linkLimit = new RateLimiter(5, 10 * 60 * 1000);

export function registerAdminBot(bot: Bot, db: DB): void {
  usernameOf = () => {
    try {
      return bot.botInfo.username;
    } catch {
      return null; // not initialised yet
    }
  };

  bot.command('admin', async (ctx) => {
    if (!ctx.from) return;
    const ru = (ctx.from.language_code ?? '').startsWith('ru');
    const role = roleOf(db, ctx.from.id);

    if (ctx.chat.type !== 'private') {
      // Never post a login link where others can read it.
      if (role) await ctx.reply(ru ? 'Напишите /admin мне в личные сообщения.' : 'Send /admin to me in a private chat.');
      return;
    }
    if (!role) {
      await ctx.reply(ru ? 'Эта команда только для команды хаба.' : 'This command is for the Hub team only.');
      return;
    }
    if (!config.webappUrl) {
      await ctx.reply(ru ? 'Адрес сайта (WEBAPP_URL) не задан.' : 'The site address (WEBAPP_URL) is not set.');
      return;
    }
    if (!linkLimit.hit(String(ctx.from.id))) {
      await ctx.reply(ru ? 'Слишком много ссылок подряд. Подождите несколько минут.' : 'Too many links in a row. Wait a few minutes.');
      return;
    }

    const url = loginUrl(issueLoginToken(db, ctx.from.id));
    const minutes = Math.round(LOGIN_TTL_MS / 60_000);
    const text = ru
      ? [
          '<b>Вход в админку</b>',
          '',
          `Ссылка работает ${minutes} минут и открывается один раз. Не пересылайте ее никому.`,
          '',
          `<a href="${esc(url)}">Открыть админку</a>`,
        ]
      : [
          '<b>Admin site sign-in</b>',
          '',
          `The link works for ${minutes} minutes and opens once. Do not forward it to anyone.`,
          '',
          `<a href="${esc(url)}">Open the admin site</a>`,
        ];
    await ctx.reply(text.join('\n'), {
      parse_mode: 'HTML',
      // A link preview would make Telegram's servers open the link.
      link_preview_options: { is_disabled: true },
      reply_markup: url.startsWith('https://') ? new InlineKeyboard().url(ru ? 'Открыть админку' : 'Open the admin site', url) : undefined,
    });
  });
}
