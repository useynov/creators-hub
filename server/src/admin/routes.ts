// The admin site's API, under /api/admin/*, and the security headers of the site's pages.
// See docs/V2-SPEC.md, "Admin workstream".
//
// These routes do NOT use the mini app's Telegram launch data. They have their own login
// (a one-time link from the bot) and a session cookie. Order of the checks on every request:
//   1. size limit of the body
//   2. CSRF rule for mutating requests (header + JSON or multipart body)
//   3. the public login routes, then the session (everything after needs one)
//   4. the roles each route declares with allow(): nothing is open by default

import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { DB } from '../db.js';
import { HubError } from '../service.js';
import { saveMedia } from '../media.js';
import { audit } from './audit.js';
import { allow, csrfGuard, devLoginEnabled, sessionGuard, STAFF, type AdminEnv } from './auth.js';
import { creatorRoutes } from './creators.js';
import { bad } from './input.js';
import { inviteRoutes } from './invites.js';
import { orderRoutes } from './orders.js';
import { overviewRoutes } from './overview.js';
import { payoutRoutes } from './payouts.js';
import { seedPreview } from './preview.js';
import { reportRoutes } from './reports.js';
import { reviewRoutes } from './review.js';
import { meRoutes, publicRoutes } from './session.js';
import { taskRoutes } from './tasks.js';
import { teamRoutes } from './team.js';

const COVER_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_PATH = '/api/admin/uploads/cover';

/** The admin pages: no framing, no referrer (the login link carries a token), only our own files. */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const pageHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const path = c.req.path;
  if (path !== '/admin' && !path.startsWith('/admin/')) return;
  c.res.headers.set('Content-Security-Policy', PAGE_CSP);
  c.res.headers.set('Referrer-Policy', 'no-referrer');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!path.startsWith('/admin/assets/')) c.res.headers.set('Cache-Control', 'no-store');
};

const apiHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'no-referrer');
};

const tooLarge = () => {
  throw bad('too_large', 'The request is too large.', 413);
};
const smallBody = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge });
const uploadBody = bodyLimit({ maxSize: COVER_MAX_BYTES + 64 * 1024, onError: tooLarge });

function uploadRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.post('/uploads/cover', allow(...STAFF), async (c) => {
    if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) throw bad('bad_body', 'Send the image as a file.');
    const form = await c.req.parseBody().catch(() => {
      throw bad('bad_body', 'Send the image as a file.');
    });
    const file = form.file;
    if (!(file instanceof File)) throw bad('file_required', 'Choose an image.');
    if (file.size > COVER_MAX_BYTES) throw bad('too_large', 'The image is larger than 5 MB.', 413);
    // The type is decided by the bytes, never by the name or the browser's word for it.
    const saved = await saveMedia('public', 'covers', Buffer.from(await file.arrayBuffer()), {
      maxBytes: COVER_MAX_BYTES,
      allow: ['jpg', 'png', 'webp'],
    }).catch(() => {
      throw bad('bad_image', 'Upload a JPG, PNG or WebP image up to 5 MB.');
    });
    audit(db, c.get('actor').id, 'upload.cover', saved.path);
    return c.json({ url: saved.url });
  });
}

// The parent app is typed for the mini app's variables; the admin API is a separate Hono app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAdminRoutes(app: Hono<any>, db: DB): void {
  app.use('*', pageHeaders);

  const api = new Hono<AdminEnv>();
  api.onError((error, c) => {
    if (error instanceof HubError) return c.json({ error: error.code, message: error.message }, error.status as 400);
    // The route pattern, not the address: no ids or query values in the log.
    console.error(`[admin] ${c.req.method} ${c.req.routePath} failed: ${error.name}`, error.stack?.split('\n').slice(1, 4).join(' '));
    return c.json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
  });

  api.use('*', apiHeaders);
  api.use('*', (c, next) => (c.req.path === UPLOAD_PATH ? uploadBody(c, next) : smallBody(c, next)));
  api.use('*', csrfGuard);

  publicRoutes(api, db);
  api.use('*', sessionGuard(db));

  meRoutes(api, db);
  overviewRoutes(api, db);
  creatorRoutes(api, db);
  inviteRoutes(api, db);
  taskRoutes(api, db);
  uploadRoutes(api, db);
  reviewRoutes(api, db);
  reportRoutes(api, db);
  orderRoutes(api, db);
  payoutRoutes(api, db);
  teamRoutes(api, db);

  app.route('/api/admin', api);

  // Local preview only (DEV_USER_ID set, not production): fill the database with believable data once.
  if (devLoginEnabled()) {
    seedPreview(db).catch((error: Error) => console.error(`[admin] preview data failed: ${error.name}`));
  }
}
