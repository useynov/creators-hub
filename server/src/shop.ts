// The shop, as a creator meets it: what is on offer, an order, the creator's own orders.
// Items are managed by the team on the admin site (server/src/admin/shop.ts).

import { now, type DB, type OrderRow, type ShopItemRow, type UserRow } from './db.js';
import { HubError } from './errors.js';
import { creatorLine, esc, notifyAdmins } from './notify.js';
import { balanceOf, localDate, monthStart } from './service.js';
import { isTeam } from './team.js';
import type { MyOrdersView, MyOrderView, ShopItemView, ShopView } from './types.js';

/** Sizes offered when an older item only says "needs a size". */
export const DEFAULT_SIZES = ['S', 'M', 'L', 'XL'];
export const MAX_PHOTOS = 6;

const list = (json: string | null): string[] => {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
  } catch {
    return [];
  }
};

/** The sizes of an item; empty when it has none. */
export function sizesOf(item: Pick<ShopItemRow, 'sizes' | 'needs_size'>): string[] {
  const sizes = list(item.sizes);
  return sizes.length ? sizes : item.needs_size ? DEFAULT_SIZES : [];
}

/** The item's own choices that are not sizes (the drink in a monthly case); empty for none. */
export const choicesOf = (item: Pick<ShopItemRow, 'choices'>): string[] => list(item.choices);

/** What a creator picks when ordering: the item's own choices when it has any, otherwise its sizes. */
export function optionsOf(item: Pick<ShopItemRow, 'choices' | 'choice_label' | 'sizes' | 'needs_size'>): { options: string[]; label: string; clothing: boolean } {
  const choices = choicesOf(item);
  if (choices.length) return { options: choices, label: item.choice_label?.trim() || 'Option', clothing: false };
  return { options: sizesOf(item), label: 'Size', clothing: true };
}

/** The first day of next month in the hub's time zone, YYYY-MM-DD: when a monthly item can be ordered again. */
export function nextMonthStart(today = localDate()): string {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The photos of an item, the cover first. A seeded item has the one photo the file gave it. */
export function imagesOf(item: Pick<ShopItemRow, 'images' | 'image_url' | 'source'>): string[] {
  const images = item.source === 'seed' ? [] : list(item.images);
  return images.length ? images : item.image_url ? [item.image_url] : [];
}

/** Orders of this creator that still count: everything but the cancelled ones. */
const mineOf = (db: DB, userId: number): Map<string, number> =>
  new Map(
    (
      db.prepare("SELECT item_id AS id, COUNT(*) AS n FROM orders WHERE user_id = ? AND status <> 'cancelled' GROUP BY item_id").all(userId) as Array<{
        id: string;
        n: number;
      }>
    ).map((row) => [row.id, row.n]),
  );

/** Orders of this creator placed since the month began, by item. */
const monthOf = (db: DB, userId: number): Map<string, number> =>
  new Map(
    (
      db
        .prepare("SELECT item_id AS id, COUNT(*) AS n FROM orders WHERE user_id = ? AND status <> 'cancelled' AND created_at >= ? GROUP BY item_id")
        .all(userId, monthStart()) as Array<{ id: string; n: number }>
    ).map((row) => [row.id, row.n]),
  );

/** What stands between this creator and the item, beyond coins and stock. */
interface Standing {
  mine: number;
  thisMonth: number;
  /** The team has confirmed the creator's account: needed for anything that is free. */
  confirmed: boolean;
}

export function itemView(item: ShopItemRow, balance: number, standing: Standing): ShopItemView {
  const { mine, thisMonth, confirmed } = standing;
  const soldOut = item.stock !== null && item.stock <= 0;
  const atLimit = item.per_creator !== null && mine >= item.per_creator;
  const monthUsed = item.per_month !== null && thisMonth >= item.per_month;
  const missing = Math.max(0, item.price - balance);
  const choice = optionsOf(item);
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    price: item.price,
    category: item.category,
    imageUrl: imagesOf(item)[0] ?? null,
    images: imagesOf(item),
    sizes: choice.options,
    needsSize: choice.options.length > 0,
    sizeLabel: choice.label,
    clothing: choice.clothing,
    delivery: item.delivery,
    left: item.stock,
    perCreator: item.per_creator,
    perMonth: item.per_month,
    nextOn: monthUsed ? nextMonthStart() : null,
    mine,
    missing,
    blocked: !item.active
      ? 'hidden'
      : soldOut
        ? 'sold_out'
        : atLimit
          ? 'limit'
          : monthUsed
            ? 'month'
            : item.price === 0 && !confirmed
              ? 'account'
              : missing > 0
                ? 'coins'
                : null,
  };
}

/**
 * Everything in the shop, in the team's order. `previewId` lets a team member open an item that
 * is still hidden, to check it in the real app before showing it to creators.
 */
export function shop(db: DB, userId: number, previewId?: string | null): ShopView {
  const items = db.prepare('SELECT * FROM shop_items WHERE active = 1 ORDER BY sort ASC, id ASC').all() as ShopItemRow[];
  if (previewId && !items.some((item) => item.id === previewId) && isTeam(db, userId)) {
    const hidden = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(previewId) as ShopItemRow | undefined;
    if (hidden) items.push(hidden);
  }
  const balance = balanceOf(db, userId);
  const mine = mineOf(db, userId);
  const month = monthOf(db, userId);
  const account = db.prepare('SELECT account_status FROM users WHERE id = ?').get(userId) as { account_status: string } | undefined;
  const confirmed = account?.account_status === 'confirmed';
  const open = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ('new', 'packed', 'shipped')").get(userId) as { n: number };
  return {
    balance,
    items: items.map((item) => itemView(item, balance, { mine: mine.get(item.id) ?? 0, thisMonth: month.get(item.id) ?? 0, confirmed })),
    openOrders: open.n,
  };
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Places an order: takes the coins, takes one from the stock, tells the team. */
export function placeOrder(db: DB, user: UserRow, itemId: string, body: Record<string, unknown>): { balance: number; orderId: number } {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(itemId) as ShopItemRow | undefined;
  if (!item) throw new HubError('item_not_found', 'This item is no longer in the shop.', 404);

  const choice = optionsOf(item);
  const sizes = choice.options;
  const size = text(body.size, 40);
  const courier = item.delivery === 'courier';
  const address = courier ? text(body.address, 300) : '';
  const phone = text(body.phone, 30);
  if (sizes.length && !sizes.includes(size)) throw new HubError('size_required', choice.clothing ? 'Choose a size.' : `Choose: ${choice.label.toLowerCase()}.`);
  // Something given for free goes only to creators whose account the team has confirmed.
  if (item.price === 0 && user.account_status !== 'confirmed') {
    throw new HubError('account_not_confirmed', 'This one opens once the team has confirmed your account.', 403);
  }
  if (courier && !address) throw new HubError('address_required', 'Add a delivery address.');
  if (courier && phone.replace(/\D/g, '').length < 7) throw new HubError('phone_required', 'Add a phone number for the courier.');

  const orderId = db.transaction(() => {
    if (balanceOf(db, user.id) < item.price) throw new HubError('not_enough_coins', 'You do not have enough coins yet.');
    if (item.per_creator !== null) {
      const had = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND item_id = ? AND status <> 'cancelled'").get(user.id, item.id) as { n: number };
      if (had.n >= item.per_creator) {
        throw new HubError('limit_reached', item.per_creator === 1 ? 'You already ordered this one.' : `This one is limited to ${item.per_creator} per creator.`, 409);
      }
    }
    if (item.per_month !== null) {
      const had = db
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND item_id = ? AND status <> 'cancelled' AND created_at >= ?")
        .get(user.id, item.id, monthStart()) as { n: number };
      if (had.n >= item.per_month) {
        throw new HubError('month_limit', item.per_month === 1 ? 'You already had this one this month. The next one is yours next month.' : `This one is limited to ${item.per_month} a month.`, 409);
      }
    }
    // The last one goes to whoever asks first: the stock only moves if there is still one to take.
    if (item.stock !== null && !db.prepare('UPDATE shop_items SET stock = stock - 1 WHERE id = ? AND stock > 0').run(item.id).changes) {
      throw new HubError('sold_out', 'This one is sold out.', 409);
    }
    const order = db
      .prepare(`INSERT INTO orders (user_id, item_id, title, price, size, address, phone, delivery, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, item.id, item.title, item.price, sizes.length ? size : null, address, phone, item.delivery, now());
    // A free item moves no coins, so it leaves no line in the wallet.
    if (item.price > 0) {
      db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, 'order', ?, ?)`).run(
        user.id,
        -item.price,
        item.title,
        String(order.lastInsertRowid),
        now(),
      );
    }
    // Only a clothing size is worth remembering in the profile; a drink is chosen anew each time.
    const wears = choice.clothing && sizes.length ? size : null;
    if (courier) {
      db.prepare('UPDATE users SET size = COALESCE(?, size), address = ?, phone = ? WHERE id = ?').run(wears, address, phone, user.id);
    } else if (wears) {
      db.prepare('UPDATE users SET size = ? WHERE id = ?').run(wears, user.id);
    }
    return Number(order.lastInsertRowid);
  })();

  void notifyAdmins(
    db,
    [
      `<b>Order #${orderId}</b>: ${esc(item.title)}${sizes.length ? `, ${esc(choice.label.toLowerCase())} ${esc(size)}` : ''} (${item.price === 0 ? 'free' : `${item.price} coins`})`,
      `Creator: ${creatorLine(user)}`,
      courier ? `Address: ${esc(address)}` : 'Delivery: send it in Telegram',
      ...(phone ? [`Phone: ${esc(phone)}`] : []),
    ].join('\n'),
  );
  return { balance: balanceOf(db, user.id), orderId };
}

/**
 * Takes an order back: the coins return to the creator and the item returns to the stock.
 * Shared by the creator (only while the order is new) and the team (until it is delivered).
 * Returns false when the order had already left the expected state, so nothing is refunded twice.
 */
export function refundOrder(db: DB, order: OrderRow, by: 'creator' | 'team', note: string | null, actorId: number | null): boolean {
  return db.transaction(() => {
    const changes = db
      .prepare("UPDATE orders SET status = 'cancelled', status_at = ?, status_by = ?, cancelled_by = ?, cancel_note = ? WHERE id = ? AND status = ?")
      .run(now(), actorId, by, note, order.id, order.status).changes;
    if (!changes) return false;
    if (order.price > 0) {
      db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, ?, 'order', ?, ?)`).run(
        order.user_id,
        order.price,
        `Order cancelled: ${order.title}`,
        String(order.id),
        now(),
      );
    }
    db.prepare('UPDATE shop_items SET stock = stock + 1 WHERE id = ? AND stock IS NOT NULL').run(order.item_id);
    return true;
  })();
}

/** A creator cancels their own order. Possible only until the team has packed it. */
export function cancelOrder(db: DB, user: UserRow, orderId: number): number {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, user.id) as OrderRow | undefined;
  if (!order) throw new HubError('order_not_found', 'This order does not exist.', 404);
  if (order.status !== 'new' || !refundOrder(db, order, 'creator', null, null)) {
    throw new HubError('too_late', 'This order is already being prepared. Write to the team if something is wrong.', 409);
  }
  void notifyAdmins(
    db,
    `<b>Order #${order.id} cancelled by the creator</b>: ${esc(order.title)}\nCreator: ${creatorLine(user)}${order.price > 0 ? `\n${order.price} coins went back.` : ''}`,
  );
  return balanceOf(db, user.id);
}

/** The creator's own orders, newest first, each with where it stands. */
export function myOrders(db: DB, userId: number): MyOrdersView {
  const rows = db
    .prepare(
      `SELECT o.*, i.image_url AS item_image, i.images AS item_images, i.source AS item_source
         FROM orders o LEFT JOIN shop_items i ON i.id = o.item_id
        WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100`,
    )
    .all(userId) as Array<OrderRow & { item_image: string | null; item_images: string | null; item_source: 'seed' | 'admin' | null }>;
  const orders: MyOrderView[] = rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    title: row.title,
    imageUrl: imagesOf({ images: row.item_images, image_url: row.item_image, source: row.item_source ?? 'seed' })[0] ?? null,
    size: row.size,
    price: row.price,
    delivery: row.delivery,
    address: row.address || null,
    status: row.status,
    createdAt: row.created_at,
    statusAt: row.status_at,
    canCancel: row.status === 'new',
    cancelledBy: row.cancelled_by,
    cancelNote: row.cancel_note,
  }));
  return { orders };
}
