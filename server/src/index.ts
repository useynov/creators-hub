import { serve } from '@hono/node-server';
import { configureBot, createBot } from './bot.js';
import { config } from './config.js';
import { openDb, syncContent } from './db.js';
import { createApp } from './http.js';
import { setApi } from './notify.js';
import { sendEventReminders } from './service.js';

const db = openDb(config.dbPath);
syncContent(db);

let botUsername: string | null = null;
let stopBot: (() => Promise<void>) | null = null;

if (config.botToken) {
  const bot = createBot(db);
  await bot.init();
  botUsername = bot.botInfo.username;
  setApi(bot.api);
  await configureBot(bot);
  // Long polling: no webhook to register, works behind any host.
  void bot.start({ onStart: () => console.log(`[bot] @${botUsername} is listening`) });
  stopBot = () => bot.stop();
  if (!config.adminIds.length) console.warn('[bot] ADMIN_IDS is empty: nobody can invite creators or review submissions.');
} else if (config.isProd) {
  console.error('BOT_TOKEN is not set. Get one from @BotFather and set it in the environment.');
  process.exit(1);
} else {
  console.warn('[bot] BOT_TOKEN is not set: running without Telegram. Bot messages are only logged in memory.');
}

const app = createApp(db, () => botUsername);
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[http] listening on :${info.port}`);
});

const reminders = setInterval(() => {
  try {
    sendEventReminders(db);
  } catch (error) {
    console.error('[jobs] reminders failed:', error);
  }
}, 15 * 60 * 1000);

async function shutdown(): Promise<void> {
  clearInterval(reminders);
  await stopBot?.();
  server.close();
  db.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
