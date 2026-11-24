import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { confirmLookup, connectView, isAgeRefused, isSetUp, startLookup } from './account.js';
import { registerAdminRoutes } from './admin/routes.js';
import { validateInitData, type TelegramUser } from './auth.js';
import { config } from './config.js';
import type { DB, UserRow } from './db.js';
import { readMedia, saveMedia } from './media.js';
import { seedPreview } from './preview.js';
import {
  answerOffer,
  buildMe,
  cancelRsvp,
  currentOffer,
  getUser,
  home,
  HubError,
  isInvited,
  joinTask,
  leaderboard,
  listEvents,
  listTasks,
  oneTask,
  parseViews,
  placeOrder,
  publicSettings,
  remindMe,
  requestCashout,
  requestDraftUpload,
  rsvp,
  sendStoryViews,
  shop,
  storyOf,
  submitDraftLink,
  submitLinks,
  updateDetails,
  upsertUser,
  wallet,
} from './service.js';
import type { Bootstrap } from './types.js';

type Env = { Variables: { user: UserRow } };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createApp(db: DB, botUsername: () => string | null): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((error, c) => {
    if (error instanceof HubError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error('[http]', error);
    return c.json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
  });

  app.get('/healthz', (c) => c.text('ok'));
  // Which version is running: the first thing to check after a deploy or a rollback.
  app.get('/version', (c) => c.json({ name: 'creators-hub', version: config.version }));

  // Files we keep ourselves and show to everyone: task covers, avatars, thumbnails.
  // Private files (story copies, screenshots) are never served here, only by the admin API.
  app.get('/media/*', async (c) => {
    const relative = decodeURIComponent(new URL(c.req.url).pathname.slice('/media/'.length));
    const file = await readMedia('public', relative);
    if (!file) return c.notFound();
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  // Brand photos (welcome, task covers, the offer). They are copied next to the code on the
  // server and are not in git, so a missing file is normal: the app shows a flat block instead.
  app.get('/brand/:file{[a-z0-9-]+\\.webp}', async (c) => {
    try {
      const data = await readFile(join(config.brandDir, c.req.param('file')));
      return c.body(new Uint8Array(data), 200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
    } catch {
      return c.notFound();
    }
  });

  // The admin panel has its own login and its own routes. They must be registered
  // before the mini app's auth below, which knows nothing about admin sessions.
  registerAdminRoutes(app, db);

  // Request bodies of the mini app are small JSON. The story screenshot route has its own, larger
  // limit, and the admin panel's routes set their own rules.
  const jsonLimit = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'too_large', message: 'That is more than the Hub can take in one go.' }, 413),
  });
  app.use('/api/*', (c, next) => {
    if (c.req.path.startsWith('/api/admin/') || /^\/api\/stories\/[^/]+\/views$/.test(c.req.path)) return next();
    return jsonLimit(c, next);
  });

  // Every mini app API call carries Telegram's signed launch data.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/admin/')) return next();
    const header = c.req.header('authorization') ?? '';
    let identity: TelegramUser | null = header.startsWith('tma ')
      ? validateInitData(header.slice(4), config.botToken)
      : null;
    let preview = false;
    if (!identity && config.devUserId) {
      // Local browser preview: act as DEV_USER_ID, no invite needed.
      const known = getUser(db, config.devUserId);
      identity = { id: config.devUserId, first_name: known?.first_name ?? 'Aruzhan', username: known?.username ?? undefined };
      preview = true;
    }
    if (!identity) return c.json({ error: 'unauthorized', message: 'Open the Hub from Telegram.' }, 401);
    // Someone refused for age stays refused, and we do not even keep their name again.
    if (isAgeRefused(db, identity.id)) {
      return c.json({ error: 'age_refused', message: 'The Hub is open to adults only.' }, 403);
    }
    if (!preview && !isInvited(db, identity)) {
      return c.json({ error: 'not_invited', message: 'The Hub is open by invitation only.' }, 403);
    }
    if (preview) await seedPreview(db, identity.id);
    const user = upsertUser(db, identity);
    // Until the setup is done (age, confirmed profile, city) only the setup itself is open.
    const setupPath = c.req.path === '/api/bootstrap' || c.req.path.startsWith('/api/me/connect');
    if (!isSetUp(db, user) && !setupPath) {
      return c.json({ error: 'setup_required', message: 'Finish the setup first.' }, 403);
    }
    c.set('user', user);
    await next();
  });

  const body = async (c: Context): Promise<Record<string, unknown>> => {
    const parsed: unknown = await c.req.json().catch(() => ({}));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  };
  const me = (c: Context<Env>) => buildMe(db, getUser(db, c.var.user.id)!);

  app.get('/api/bootstrap', (c) => c.json({ me: me(c), settings: publicSettings(botUsername()) } satisfies Bootstrap));

  // Connecting the Instagram account: on the first setup (with the date of birth) and when the handle changes.
  app.get('/api/me/connect', (c) => c.json(connectView(db, c.var.user.id)));
  app.post('/api/me/connect', async (c) => c.json(startLookup(db, c.var.user, await body(c))));
  app.post('/api/me/connect/confirm', async (c) => {
    confirmLookup(db, c.var.user, await body(c));
    return c.json(me(c));
  });
  app.patch('/api/me', async (c) => {
    updateDetails(db, c.var.user, await body(c));
    return c.json(me(c));
  });

  app.get('/api/home', (c) => c.json(home(db, c.var.user.id)));

  app.get('/api/tasks', (c) => c.json(listTasks(db, c.var.user.id)));
  app.get('/api/tasks/:id', (c) => c.json(oneTask(db, c.var.user.id, c.req.param('id'))));
  app.post('/api/tasks/:id/join', (c) => c.json(joinTask(db, c.var.user, c.req.param('id'))));
  app.post('/api/tasks/:id/submit', async (c) => c.json(await submitLinks(db, c.var.user, c.req.param('id'), await body(c))));
  app.post('/api/tasks/:id/draft', async (c) => c.json(submitDraftLink(db, c.var.user, c.req.param('id'), await body(c))));
  app.post('/api/tasks/:id/draft-upload', (c) => {
    requestDraftUpload(db, c.var.user, c.req.param('id'));
    return c.json({ ok: true });
  });

  // Story views: the number and a screenshot of the statistics. Both stay private to the team.
  const storyId = (c: Context): number => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) throw new HubError('story_not_found', 'This story is not one of yours.', 404);
    return id;
  };
  app.get('/api/stories/:id', (c) => c.json(storyOf(db, c.var.user.id, storyId(c)).view));
  // The creator may see the copy we kept of their own story, nobody else may (no static route for it).
  app.get('/api/stories/:id/copy', async (c) => {
    const { publication, view } = storyOf(db, c.var.user.id, storyId(c));
    const file = view.copyIsImage && publication.media_path ? await readMedia('private', publication.media_path) : null;
    if (!file) return c.json({ error: 'not_found', message: 'Not found.' }, 404);
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });
  app.post(
    '/api/stories/:id/views',
    bodyLimit({
      maxSize: 9 * 1024 * 1024,
      onError: (c) => c.json({ error: 'too_large', message: 'The screenshot is too large. Send one under 8 MB.' }, 413),
    }),
    async (c) => {
      const id = storyId(c);
      const form = (c.req.header('content-type') ?? '').startsWith('multipart/form-data')
        ? await c.req.parseBody()
        : ((await body(c)) as Record<string, unknown>);
      // Refuse someone else's story, a closed one or a bad number before any file is written.
      if (!storyOf(db, c.var.user.id, id).view.editable) {
        throw new HubError('story_closed', 'This work is approved: the number can no longer change. Write to the team if it is wrong.');
      }
      parseViews(form.views);
      let screenshot: string | null = null;
      const file = form.screenshot;
      if (file instanceof File && file.size > 0) {
        try {
          const saved = await saveMedia('private', 'screens', Buffer.from(await file.arrayBuffer()), {
            maxBytes: 8 * 1024 * 1024,
            allow: ['jpg', 'png', 'webp'],
          });
          screenshot = saved.path;
        } catch {
          throw new HubError('bad_screenshot', 'The screenshot must be a picture (JPG, PNG or WebP) under 8 MB.');
        }
      }
      return c.json(sendStoryViews(db, c.var.user, id, form.views, screenshot));
    },
  );

  app.get('/api/wallet', (c) => c.json(wallet(db, c.var.user.id)));
  app.get('/api/shop', (c) => c.json(shop(db, c.var.user.id)));
  app.post('/api/shop/:id/order', async (c) =>
    c.json({ balance: placeOrder(db, c.var.user, c.req.param('id'), await body(c)) }),
  );
  app.post('/api/cashout', async (c) => c.json({ balance: requestCashout(db, c.var.user, await body(c)) }));

  app.get('/api/events', (c) => c.json(listEvents(db, c.var.user.id)));
  app.post('/api/events/:id/rsvp', (c) => {
    rsvp(db, c.var.user, c.req.param('id'));
    return c.json(listEvents(db, c.var.user.id));
  });
  app.delete('/api/events/:id/rsvp', (c) => {
    cancelRsvp(db, c.var.user, c.req.param('id'));
    return c.json(listEvents(db, c.var.user.id));
  });
  app.post('/api/events/:id/remind', (c) => {
    remindMe(db, c.var.user.id, c.req.param('id'));
    return c.json(listEvents(db, c.var.user.id));
  });

  app.get('/api/leaderboard', (c) =>
    c.json(leaderboard(db, c.var.user.id, c.req.query('period') === 'all' ? 'all' : 'month')),
  );

  app.get('/api/offer', (c) => c.json(currentOffer(db, c.var.user.id)));
  app.post('/api/offer/:id/:answer{accept|decline}', (c) => {
    answerOffer(db, c.var.user, Number(c.req.param('id')), c.req.param('answer') === 'accept');
    return c.json({ ok: true });
  });

  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  // The built admin panel lives under /admin. Unknown paths there fall back to its index.html.
  // The built mini app serves everything else, and falls back to its own index.html so that
  // links from the bot (for example /tasks/caravan-shoot) open the right screen.
  app.get('*', async (c) => {
    let requested: string;
    try {
      requested = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    } catch {
      return c.notFound();
    }
    const isAdmin = requested === '/admin' || requested.startsWith('/admin/');
    const root = isAdmin ? config.adminDist : config.webDist;
    const inside = isAdmin ? requested.slice('/admin'.length) || '/' : requested;
    const isAsset = Boolean(extname(inside));
    const file = join(root, isAsset ? inside : 'index.html');
    if (file !== root && !file.startsWith(root + sep)) return c.notFound();
    try {
      const data = await readFile(file);
      return c.body(new Uint8Array(data), 200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': inside.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
    } catch {
      return isAsset ? c.notFound() : c.text('This part of the app is not built yet. Run: npm run build', 503);
    }
  });

  return app;
}
