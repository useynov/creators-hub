// The admin panel's API, under /api/admin/*. Filled in by the admin workstream.
// See docs/V2-SPEC.md, "Admin panel".
//
// These routes do NOT use the mini app's Telegram launch data. They have their own
// login (a one-time link from the bot) and a session cookie, and every route checks the role.

import type { Hono } from 'hono';
import type { DB } from '../db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAdminRoutes(app: Hono<any>, _db: DB): void {
  app.all('/api/admin/*', (c) => c.json({ error: 'not_built', message: 'The admin panel is not built yet.' }, 501));
}
