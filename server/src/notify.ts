import { InlineKeyboard, type Api } from 'grammy';
import { config } from './config.js';
import type { DB, UserRow } from './db.js';
import { teamChats } from './team.js';

/**
 * Everything the bot says on its own initiative goes through here.
 * Without a bot token (tests, local preview) messages land in `outbox` instead.
 */
let api: Api | null = null;

export interface SentMessage {
  chatId: number;
  html: string;
  button?: string;
}
export const outbox: SentMessage[] = [];

export function setApi(next: Api | null): void {
  api = next;
}

export function esc(text: string | number | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** A button that opens the mini app on a given screen. Private chats only. */
export function appButton(text: string, path = '/'): InlineKeyboard | undefined {
  if (!config.webappUrl.startsWith('https://')) return undefined;
  return new InlineKeyboard().webApp(text, config.webappUrl + path);
}

export async function notifyUser(
  userId: number,
  html: string,
  button?: { text: string; path: string },
): Promise<void> {
  if (!api) {
    outbox.push({ chatId: userId, html, button: button?.path });
    return;
  }
  try {
    await api.sendMessage(userId, html, {
      parse_mode: 'HTML',
      reply_markup: button ? appButton(button.text, button.path) : undefined,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    // Most often the creator has blocked the bot. Nothing to do about it here.
    console.warn(`[notify] could not message user ${userId}:`, (error as Error).message);
  }
}

export async function notifyAdmins(
  db: DB,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<Array<{ chatId: number; messageId: number }>> {
  const sent: Array<{ chatId: number; messageId: number }> = [];
  for (const chatId of teamChats(db)) {
    if (!api) {
      outbox.push({ chatId, html });
      continue;
    }
    try {
      const message = await api.sendMessage(chatId, html, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
      sent.push({ chatId, messageId: message.message_id });
    } catch (error) {
      console.warn(`[notify] could not message admin chat ${chatId}:`, (error as Error).message);
    }
  }
  return sent;
}

/** Copies a creator's message (a draft video, for example) to the team. */
export async function copyToAdmins(db: DB, fromChatId: number, messageId: number): Promise<void> {
  if (!api) return;
  for (const chatId of teamChats(db)) {
    try {
      await api.copyMessage(chatId, fromChatId, messageId);
    } catch (error) {
      console.warn(`[notify] could not copy message to ${chatId}:`, (error as Error).message);
    }
  }
}

/** Who a creator is, for the team's messages. */
export function creatorLine(user: UserRow): string {
  const parts = [`<b>${esc(user.first_name)}</b>`];
  if (user.username) parts.push(`@${esc(user.username)}`);
  if (user.instagram) parts.push(`IG <a href="https://instagram.com/${esc(user.instagram)}">@${esc(user.instagram)}</a>`);
  return parts.join(' · ');
}

export function reviewKeyboard(entryId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Approve ★3', `ap:${entryId}:3`)
    .text('★4', `ap:${entryId}:4`)
    .text('★5', `ap:${entryId}:5`)
    .row()
    .text('Needs changes', `nc:${entryId}`);
}

/** Under "New account to confirm": the team's decision on the creator's Instagram account. */
export function accountKeyboard(userId: number): InlineKeyboard {
  return new InlineKeyboard().text('Confirm', `ac:${userId}`).text('Reject', `ar:${userId}`);
}

export function draftKeyboard(entryId: number): InlineKeyboard {
  return new InlineKeyboard().text('Approve draft', `da:${entryId}`).text('Needs changes', `nc:${entryId}`);
}
