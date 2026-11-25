// The shop, as the team runs it: add an item, give it photos, a price and a description, say
// how many are left, show or hide it, put the items in order, and check an item in the real app
// before creators see it. Owner and Manager change things; a Viewer can look.
//
// An item is never deleted once someone ordered it: it is hidden, so old orders keep their name.

import type { Hono } from 'hono';
import { now, type DB, type ShopItemRow } from '../db.js';
import { esc, notifyUser } from '../notify.js';
import { choicesOf, DEFAULT_SIZES, imagesOf, MAX_PHOTOS, sizesOf } from '../shop.js';
import { audit } from './audit.js';
import { allow, EVERYONE, STAFF, type AdminEnv } from './auth.js';
import { bad, int, oneOf, readJson, requiredInt, requiredText, stringList, text } from './input.js';
import type { ShopItemAdmin, ShopItemInput, ShopItemsList } from './types.js';

/** Only photos we stored ourselves can be put on an item: no outside addresses. */
const OUR_PHOTO = /^\/media\/(covers|seed)\/[0-9a-f]{24}\.(jpg|png|webp)$|^\/brand\/[a-z0-9-]+\.webp$/;
const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];
const MAX_CHOICES = 12;

type Counted = ShopItemRow & { ordered: number; waiting: number };

const COUNTED = `
  SELECT i.*,
         (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND o.status <> 'cancelled') AS ordered,
         (SELECT COUNT(*) FROM orders o WHERE o.item_id = i.id AND o.status = 'new') AS waiting
    FROM shop_items i`;

const view = (row: Counted): ShopItemAdmin => ({
  id: row.id,
  title: row.title,
  description: row.description,
  price: row.price,
  category: row.category,
  images: imagesOf(row),
  sizes: sizesOf(row),
  choices: choicesOf(row),
  choiceLabel: row.choice_label,
  delivery: row.delivery,
  stock: row.stock,
  perCreator: row.per_creator,
  perMonth: row.per_month,
  visible: Boolean(row.active),
  ordered: row.ordered,
  waiting: row.waiting,
  updatedAt: row.updated_at,
});

export function listItems(db: DB): ShopItemsList {
  // Visible items first, in the order creators see them; hidden ones after.
  const rows = db.prepare(`${COUNTED} ORDER BY i.active DESC, i.sort ASC, i.id ASC`).all() as Counted[];
  return { items: rows.map(view) };
}

export function getItem(db: DB, id: string): ShopItemAdmin {
  const row = db.prepare(`${COUNTED} WHERE i.id = ?`).get(id) as Counted | undefined;
  if (!row) throw bad('not_found', 'This item does not exist.', 404);
  return view(row);
}

export function parseItem(raw: Record<string, unknown>): ShopItemInput {
  const images = stringList(raw.images ?? [], 'images', { maxItems: MAX_PHOTOS, maxLength: 120 });
  for (const image of images) if (!OUR_PHOTO.test(image)) throw bad('bad_photo', 'Upload the photo here first.');
  const sizes = stringList(raw.sizes ?? [], 'sizes', { maxItems: ALL_SIZES.length, maxLength: 12 });
  for (const size of sizes) if (!ALL_SIZES.includes(size)) throw bad('bad_size', `Unknown size: ${size}.`);
  // The item's own choice (the drink in a case). One thing is chosen per order, so it is this or sizes.
  const choices = [...new Set(stringList(raw.choices ?? [], 'choices', { maxItems: MAX_CHOICES, maxLength: 40 }))];
  if (choices.length === 1) throw bad('one_choice', 'A choice needs at least two options.');
  if (choices.length && sizes.length) throw bad('sizes_or_choices', 'An item has sizes or its own choice, not both.');
  const choiceLabel = choices.length ? (text(raw.choiceLabel, 'choiceLabel', { max: 20 }) ?? 'Option') : null;
  return {
    title: requiredText(raw.title, 'title', { max: 60, min: 2 }),
    description: text(raw.description, 'description', { max: 1200, multiline: true }),
    // 0 is a gift: no coins move, and only creators with a confirmed account can take it.
    price: requiredInt(raw.price, 'price', { min: 0, max: 100_000 }),
    category: oneOf(raw.category, 'category', ['merch', 'gift'] as const),
    images: [...new Set(images)],
    // Kept in the order of the size chart, whatever order they were ticked in.
    sizes: ALL_SIZES.filter((size) => sizes.includes(size)),
    choices,
    choiceLabel,
    delivery: oneOf(raw.delivery, 'delivery', ['courier', 'message'] as const),
    stock: int(raw.stock, 'stock', { min: 0, max: 100_000 }),
    perCreator: int(raw.perCreator, 'perCreator', { min: 1, max: 100 }),
    perMonth: int(raw.perMonth, 'perMonth', { min: 1, max: 31 }),
    visible: raw.visible === true,
  };
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';

function freshId(db: DB, title: string): string {
  const base = slug(title);
  const taken = db.prepare('SELECT 1 FROM shop_items WHERE id = ?');
  if (!taken.get(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.get(`${base}-${n}`)) return `${base}-${n}`;
  throw bad('id_taken', 'Give the item a different name.', 409);
}

const columns = (item: ShopItemInput) => ({
  title: item.title,
  description: item.description,
  price: item.price,
  category: item.category,
  image_url: item.images[0] ?? null,
  images: JSON.stringify(item.images),
  needs_size: item.sizes.length ? 1 : 0,
  sizes: item.sizes.length ? JSON.stringify(item.sizes) : null,
  choices: item.choices.length ? JSON.stringify(item.choices) : null,
  choice_label: item.choiceLabel,
  delivery: item.delivery,
  stock: item.stock,
  per_creator: item.perCreator,
  per_month: item.perMonth,
  active: item.visible ? 1 : 0,
  updated_at: now(),
});

export function createItem(db: DB, actorId: number, item: ShopItemInput): ShopItemAdmin {
  const id = db.transaction(() => {
    const fresh = freshId(db, item.title);
    const last = db.prepare('SELECT COALESCE(MAX(sort), -1) AS n FROM shop_items').get() as { n: number };
    db.prepare(
      `INSERT INTO shop_items (id, title, description, price, category, image_url, images, needs_size, sizes, choices, choice_label, delivery, stock, per_creator, per_month, active, sort, source, updated_at)
       VALUES (@id, @title, @description, @price, @category, @image_url, @images, @needs_size, @sizes, @choices, @choice_label, @delivery, @stock, @per_creator, @per_month, @active, @sort, 'admin', @updated_at)`,
    ).run({ id: fresh, sort: last.n + 1, ...columns(item) });
    audit(db, actorId, 'shop.create', fresh, item.title);
    return fresh;
  })();
  return getItem(db, id);
}

export function updateItem(db: DB, actorId: number, id: string, item: ShopItemInput): ShopItemAdmin {
  const changes = db
    .prepare(
      `UPDATE shop_items SET title = @title, description = @description, price = @price, category = @category, image_url = @image_url,
         images = @images, needs_size = @needs_size, sizes = @sizes, choices = @choices, choice_label = @choice_label, delivery = @delivery,
         stock = @stock, per_creator = @per_creator, per_month = @per_month, active = @active, source = 'admin', updated_at = @updated_at WHERE id = @id`,
    )
    .run({ id, ...columns(item) }).changes;
  if (!changes) throw bad('not_found', 'This item does not exist.', 404);
  audit(db, actorId, 'shop.update', id, item.title);
  return getItem(db, id);
}

export function setVisible(db: DB, actorId: number, id: string, visible: boolean): void {
  const changes = db.prepare("UPDATE shop_items SET active = ?, source = 'admin', updated_at = ? WHERE id = ?").run(visible ? 1 : 0, now(), id).changes;
  if (!changes) throw bad('not_found', 'This item does not exist.', 404);
  audit(db, actorId, visible ? 'shop.show' : 'shop.hide', id);
}

/** Puts the items in the given order. Items left out keep their place after the listed ones. */
export function reorder(db: DB, actorId: number, ids: string[]): void {
  db.transaction(() => {
    const known = new Set((db.prepare('SELECT id FROM shop_items').all() as Array<{ id: string }>).map((row) => row.id));
    const rest = (db.prepare('SELECT id FROM shop_items ORDER BY sort ASC, id ASC').all() as Array<{ id: string }>).map((row) => row.id).filter((id) => !ids.includes(id));
    const set = db.prepare("UPDATE shop_items SET sort = ?, source = 'admin' WHERE id = ?");
    [...ids.filter((id) => known.has(id)), ...rest].forEach((id, index) => set.run(index, id));
    audit(db, actorId, 'shop.reorder', null, ids.join(', ').slice(0, 300));
  })();
}

/** Removes an item nobody ordered (a mistake, a test). Anything with orders can only be hidden. */
export function removeItem(db: DB, actorId: number, id: string): void {
  const item = db.prepare('SELECT title FROM shop_items WHERE id = ?').get(id) as { title: string } | undefined;
  if (!item) throw bad('not_found', 'This item does not exist.', 404);
  const orders = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE item_id = ?').get(id) as { n: number };
  if (orders.n) throw bad('has_orders', 'This item has orders, so it can only be hidden.', 409);
  db.prepare('DELETE FROM shop_items WHERE id = ?').run(id);
  audit(db, actorId, 'shop.remove', id, item.title);
}

const itemId = (raw: string | undefined): string => {
  if (!raw || !ITEM_ID.test(raw)) throw bad('not_found', 'This item does not exist.', 404);
  return raw;
};

export function shopRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/shop/items', allow(...EVERYONE), (c) => c.json({ ...listItems(db), sizes: ALL_SIZES, defaultSizes: DEFAULT_SIZES, maxPhotos: MAX_PHOTOS }));
  api.get('/shop/items/:id', allow(...EVERYONE), (c) => c.json(getItem(db, itemId(c.req.param('id')))));

  api.post('/shop/items', allow(...STAFF), async (c) => c.json(createItem(db, c.get('actor').id, parseItem(await readJson(c)))));
  api.put('/shop/items/:id', allow(...STAFF), async (c) => c.json(updateItem(db, c.get('actor').id, itemId(c.req.param('id')), parseItem(await readJson(c)))));
  api.delete('/shop/items/:id', allow(...STAFF), (c) => {
    removeItem(db, c.get('actor').id, itemId(c.req.param('id')));
    return c.json({ ok: true });
  });

  api.post('/shop/items/:id/visible', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    setVisible(db, c.get('actor').id, itemId(c.req.param('id')), body.visible === true);
    return c.json({ ok: true });
  });

  api.post('/shop/order', allow(...STAFF), async (c) => {
    const body = await readJson(c);
    reorder(db, c.get('actor').id, stringList(body.ids, 'ids', { maxItems: 500, maxLength: 48 }));
    return c.json(listItems(db));
  });

  // "Send it to my Telegram": the bot sends a button that opens this item in the real app,
  // also while it is still hidden from creators. The surest way to check photos on a phone.
  api.post('/shop/items/:id/send', allow(...STAFF), async (c) => {
    const item = getItem(db, itemId(c.req.param('id')));
    await notifyUser(
      c.get('actor').id,
      `<b>${esc(item.title)}</b>, ${item.price === 0 ? 'free' : `${item.price} coins`}.\n${item.visible ? 'This is how creators see it in the shop.' : 'Hidden from creators for now: only the team can open it.'}`,
      { text: 'Open in the app', path: `/shop/${item.id}?preview=1` },
    );
    return c.json({ ok: true });
  });
}
