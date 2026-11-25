import { serve } from '@hono/node-server';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configureBot, createBot } from './bot.js';
import { config } from './config.js';
import { openDb, syncContent } from './db.js';
import { createApp } from './http.js';
import { startJobs } from './jobs.js';
import { setApi } from './notify.js';
import { sendEventReminders, sendTaskReminders } from './service.js';

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

// Brand files are copied to the server by hand. Say so at once when one is there but empty
// or unreadable: the app would quietly fall back to another font and the name in type.
try {
  const broken = readdirSync(config.brandDir).filter((name) => {
    const file = join(config.brandDir, name);
    try {
      accessSync(file, constants.R_OK);
      return statSync(file).size === 0;
    } catch {
      return true;
    }
  });
  if (broken.length) console.error(`[brand] ${broken.length} file(s) in content/brand are empty or unreadable: ${broken.join(', ')}. Check their permissions (chmod 644) and rebuild.`);
} catch {
  console.warn('[brand] content/brand is missing: photos, the brand font and the logo fall back to plain blocks, Onest and type.');
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

// "Remind me" on a task that opens later: the message should come close to the opening.
const taskReminders = setInterval(() => {
  try {
    sendTaskReminders(db);
  } catch (error) {
    console.error('[jobs] task reminders failed:', error);
  }
}, 2 * 60 * 1000);

const stopJobs = startJobs(db);

async function shutdown(): Promise<void> {
  clearInterval(reminders);
  clearInterval(taskReminders);
  stopJobs();
  await stopBot?.();
  server.close();
  db.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
