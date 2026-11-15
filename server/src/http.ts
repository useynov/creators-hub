import { Hono, type Context } from 'hono';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { validateInitData, type TelegramUser } from './auth.js';
import { config } from './config.js';
import type { DB, UserRow } from './db.js';
import {
  answerOffer,
  buildMe,
  cancelRsvp,
  completeSetup,
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
  placeOrder,
  publicSettings,
  remindMe,
  requestCashout,
  requestDraftUpload,
  rsvp,
  shop,
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

  // Every API call carries Telegram's signed launch data.
  app.use('/api/*', async (c, next) => {
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
    if (!preview && !isInvited(db, identity)) {
      return c.json({ error: 'not_invited', message: 'The Hub is open by invitation only.' }, 403);
    }
    c.set('user', upsertUser(db, identity));
    await next();
  });

  const body = async (c: Context): Promise<Record<string, unknown>> => {
    const parsed: unknown = await c.req.json().catch(() => ({}));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  };
  const me = (c: Context<Env>) => buildMe(db, getUser(db, c.var.user.id)!);

  app.get('/api/bootstrap', (c) => c.json({ me: me(c), settings: publicSettings(botUsername()) } satisfies Bootstrap));

  app.post('/api/me/setup', async (c) => {
    completeSetup(db, c.var.user, await body(c));
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
  app.post('/api/tasks/:id/submit', async (c) => c.json(submitLinks(db, c.var.user, c.req.param('id'), await body(c))));
  app.post('/api/tasks/:id/draft', async (c) => c.json(submitDraftLink(db, c.var.user, c.req.param('id'), await body(c))));
  app.post('/api/tasks/:id/draft-upload', (c) => {
    requestDraftUpload(db, c.var.user, c.req.param('id'));
    return c.json({ ok: true });
  });

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

  // The built mini app. Any unknown path falls back to index.html so that
  // links from the bot (for example /tasks/caravan-shoot) open the right screen.
  app.get('*', async (c) => {
    const requested = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    const isAsset = Boolean(extname(requested));
    const file = join(config.webDist, isAsset ? requested : 'index.html');
    if (!file.startsWith(config.webDist)) return c.notFound();
    try {
      const data = await readFile(file);
      return c.body(data, 200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': requested.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    } catch {
      return isAsset ? c.notFound() : c.text('The mini app is not built yet. Run: npm run build', 503);
    }
  });

  return app;
}
