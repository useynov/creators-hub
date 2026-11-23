// Bot commands that belong to the admin panel (the /admin login link, for example).
// Filled in by the admin workstream. Registered before the bot's catch-all message handler.

import type { Bot } from 'grammy';
import type { DB } from '../db.js';

export function registerAdminBot(_bot: Bot, _db: DB): void {
  /* nothing yet */
}
