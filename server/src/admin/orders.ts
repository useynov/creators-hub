// Orders from the shop: one step forward at a time (new, packed, shipped, delivered), a bot
// message to the creator on each step, and the courier's list as an Excel file. Until an order
// is delivered the team can cancel it: the coins go back and the item returns to the stock.
// Owner and Manager only: orders carry addresses and phones.

import type { Hono } from 'hono';
import { now, type DB, type OrderRow } from '../db.js';
import { esc, notifyUser } from '../notify.js';
import { imagesOf, refundOrder } from '../shop.js';
import { audit } from './audit.js';
import { allow, STAFF, type AdminEnv } from './auth.js';
import { ordersWorkbook, xlsxResponse } from './excel.js';
import { bad, idParam, oneOf, pageParams, queryOneOf, readJson, text } from './input.js';
import type { OrderList, OrderRowView, OrderStatus } from './types.js';

export const ORDER_STEPS: readonly OrderStatus[] = ['new', 'packed', 'shipped', 'delivered'];
/** The tabs of the list: the four steps and what was cancelled. */
export const ORDER_TABS: readonly OrderStatus[] = [...ORDER_STEPS, 'cancelled'];
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { new: 'packed', packed: 'shipped', shipped: 'delivered' };

/** What the creator hears at each step. The mini app is in English, and so is the bot. */
const MESSAGES: Record<'packed' | 'shipped' | 'delivered', (title: string) => string> = {
  packed: (title) => `<b>Your order is packed.</b> ${esc(title)} will be on its way soon.`,
  shipped: (title) => `<b>Your order is on its way.</b> ${esc(title)} is with the courier now.`,
  delivered: (title) => `<b>Delivered.</b> Enjoy your ${esc(title)}!`,
};

type Joined = OrderRow & {
  first_name: string;
  instagram: string | null;
  item_image: string | null;
  item_images: string | null;
  item_source: 'seed' | 'admin' | null;
};

const view = (row: Joined): OrderRowView => ({
  id: row.id,
  creator: { id: row.user_id, name: row.first_name, instagram: row.instagram },
  title: row.title,
  imageUrl: imagesOf({ images: row.item_images, image_url: row.item_image, source: row.item_source ?? 'seed' })[0] ?? null,
  size: row.size,
  delivery: row.delivery,
  address: row.address,
  phone: row.phone,
  coins: row.price,
  status: row.status,
  createdAt: row.created_at,
  statusAt: row.status_at,
  cancelledBy: row.cancelled_by,
  cancelNote: row.cancel_note,
});

const SELECT = `SELECT o.*, u.first_name, u.instagram, i.image_url AS item_image, i.images AS item_images, i.source AS item_source
  FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN shop_items i ON i.id = o.item_id WHERE o.status = ?`;

export function listOrders(db: DB, status: OrderStatus, page: { page: number; pageSize: number; offset: number }): OrderList {
  const counts = Object.fromEntries(ORDER_TABS.map((step) => [step, 0])) as Record<OrderStatus, number>;
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all() as Array<{ status: OrderStatus; n: number }>) {
    if (row.status in counts) counts[row.status] = row.n;
  }
  const rows = db.prepare(`${SELECT} ORDER BY o.id ${status === 'new' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).all(status, page.pageSize, page.offset) as Joined[];
  return { rows: rows.map(view), total: counts[status], page: page.page, pageSize: page.pageSize, counts };
}

/**
 * Moves an order one step forward. `from` is the step the team saw: if the order has already
 * moved (a second press, or a colleague), nothing happens and the creator gets no second message.
 */
export function advanceOrder(db: DB, actorId: number, id: number, from: OrderStatus): OrderStatus {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!order) throw bad('not_found', 'This order does not exist.', 404);
  const next = NEXT[from];
  if (!next) throw bad('last_step', 'This order is already delivered.', 409);
  const moved = db.transaction(() => {
    const changes = db
      .prepare('UPDATE orders SET status = ?, status_at = ?, status_by = ? WHERE id = ? AND status = ?')
      .run(next, now(), actorId, id, from).changes;
    if (changes) audit(db, actorId, 'order.step', id, `${from} → ${next}`);
    return changes > 0;
  })();
  if (!moved) throw bad('already_moved', 'This order has already moved on. The list is refreshed.', 409);
  void notifyUser(order.user_id, MESSAGES[next as 'packed' | 'shipped' | 'delivered'](order.title), { text: 'See your order', path: '/shop/orders' });
  return next;
}

/** The team cancels an order that is not delivered yet. The creator is told why and gets the coins back. */
export function cancelOrderByTeam(db: DB, actorId: number, id: number, note: string): void {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!order) throw bad('not_found', 'This order does not exist.', 404);
  if (order.status === 'delivered') throw bad('delivered', 'A delivered order cannot be cancelled. Give the coins back by hand if needed.', 409);
  if (order.status === 'cancelled' || !refundOrder(db, order, 'team', note, actorId)) {
    throw bad('already_moved', 'This order has already moved on. The list is refreshed.', 409);
  }
  audit(db, actorId, 'order.cancel', id, note);
  void notifyUser(
    order.user_id,
    `<b>Your order was cancelled.</b> ${esc(order.title)}: ${esc(note)}\n${order.price} coins are back on your balance.`,
    { text: 'Open the shop', path: '/shop' },
  );
}

export function orderRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/orders', allow(...STAFF), (c) => c.json(listOrders(db, queryOneOf(c.req.query('status'), ORDER_TABS, 'new'), pageParams(c))));

  api.post('/orders/:id/cancel', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const note = text(body.note, 'note', { max: 300, required: true })!;
    cancelOrderByTeam(db, c.get('actor').id, id, note);
    return c.json({ ok: true });
  });

  api.post('/orders/:id/advance', allow(...STAFF), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    const from = oneOf(body.from, 'from', ORDER_STEPS);
    advanceOrder(db, c.get('actor').id, id, from);
    return c.json({ ok: true });
  });

  // The courier's list: the orders of one tab, all of them.
  api.get('/orders/export', allow(...STAFF), async (c) => {
    const status = queryOneOf(c.req.query('status'), ORDER_TABS, 'packed');
    const lang = queryOneOf(c.req.query('lang'), ['ru', 'en'] as const, 'ru');
    const rows = (db.prepare(`${SELECT} ORDER BY o.id LIMIT 5000`).all(status) as Joined[]).map(view);
    audit(db, c.get('actor').id, 'order.export', null, `${status}, ${rows.length} rows`);
    return xlsxResponse(c, await ordersWorkbook(rows, lang), `orders-${status}.xlsx`);
  });
}
