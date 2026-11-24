// The shop: what a creator can order and when, what happens to coins and stock when an order
// is placed or taken back, and that the team's items survive a restart.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.ADMIN_IDS = '900';
process.env.WEBAPP_URL = 'https://hub.example';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'hub-shop-'));
delete process.env.DEV_USER_ID;
delete process.env.ADMIN_CHAT_ID;

const { openDb, syncContent, now } = await import('./db.js');
const { balanceOf } = await import('./service.js');
const { shop, placeOrder, cancelOrder, myOrders } = await import('./shop.js');
const { createItem, updateItem, parseItem, listItems, reorder, removeItem, setVisible } = await import('./admin/shop.js');
const { cancelOrderByTeam, advanceOrder, listOrders } = await import('./admin/orders.js');
const { outbox } = await import('./notify.js');
const { HubError } = await import('./errors.js');
type UserRow = import('./db.js').UserRow;

const db = openDb(':memory:');
syncContent(db);

const PHOTO_A = '/media/covers/aaaaaaaaaaaaaaaaaaaaaaaa.webp';
const PHOTO_B = '/media/covers/bbbbbbbbbbbbbbbbbbbbbbbb.webp';

function creator(id: number, coins: number): UserRow {
  db.prepare(
    `INSERT INTO users (id, username, first_name, instagram, city, birth_date, onboarded_at, created_at, account_status)
     VALUES (?, ?, ?, ?, 'Almaty', '1995-05-05', ?, ?, 'confirmed')`,
  ).run(id, `user${id}`, `User${id}`, `user.${id}`, now(), now());
  if (coins) db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, created_at) VALUES (?, ?, 'Test coins', 'bonus', ?)`).run(id, coins, now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

const input = (over: Record<string, unknown> = {}) =>
  parseItem({ title: 'Cap', description: 'A red cap.', price: 10, category: 'merch', images: [PHOTO_A, PHOTO_B], sizes: [], delivery: 'courier', stock: null, perCreator: null, visible: true, ...over });

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof HubError) return error.code;
    throw error;
  }
  return 'no error';
};

const WHERE = { address: 'Almaty, Abay Ave 1', phone: '+7 700 000 0000' };

test('an item made on the admin site shows in the shop with its photos, the cover first', () => {
  const cap = createItem(db, 900, input());
  assert.equal(cap.id, 'cap');
  const seen = shop(db, creator(1, 25).id).items.find((item) => item.id === 'cap')!;
  assert.deepEqual(seen.images, [PHOTO_A, PHOTO_B]);
  assert.equal(seen.imageUrl, PHOTO_A);
  assert.equal(seen.description, 'A red cap.');
  assert.equal(seen.blocked, null);
  assert.equal(createItem(db, 900, input()).id, 'cap-2', 'a second item with the same name gets its own id');
});

test('only photos stored here can be put on an item', () => {
  assert.equal(codeOf(() => input({ images: ['https://elsewhere.example/cap.jpg'] })), 'bad_photo');
  assert.equal(codeOf(() => input({ images: ['/media/covers/../../etc/passwd'] })), 'bad_photo');
  assert.equal(codeOf(() => input({ sizes: ['Huge'] })), 'bad_size');
  assert.deepEqual(input({ sizes: ['L', 'S'] }).sizes, ['S', 'L'], 'sizes are kept in chart order');
});

test('the seed file never undoes what the team did on the admin site', () => {
  updateItem(db, 900, 'hoodie', input({ title: 'Hoodie, red', price: 77, stock: 3 }));
  setVisible(db, 900, 'tote-bag', false);
  syncContent(db);
  const items = listItems(db).items;
  const hoodie = items.find((item) => item.id === 'hoodie')!;
  assert.equal(hoodie.title, 'Hoodie, red');
  assert.equal(hoodie.price, 77);
  assert.equal(hoodie.stock, 3);
  assert.equal(items.find((item) => item.id === 'tote-bag')!.visible, false, 'a hidden item stays hidden after a restart');
  assert.equal(items.find((item) => item.id === 'cap')!.visible, true, 'an item that is not in the file stays visible');
  assert.equal(items.find((item) => item.id === 't-shirt')!.visible, true, 'an untouched seed item is still there');
});

test('an order takes the coins and one from the stock; the last one goes to whoever asks first', () => {
  updateItem(db, 900, 'cap', input({ stock: 1 }));
  const first = creator(2, 30);
  const second = creator(3, 30);
  const placed = placeOrder(db, first, 'cap', WHERE);
  assert.equal(placed.balance, 20);
  assert.equal(listItems(db).items.find((item) => item.id === 'cap')!.stock, 0);
  assert.equal(shop(db, second.id).items.find((item) => item.id === 'cap')!.blocked, 'sold_out');
  assert.equal(codeOf(() => placeOrder(db, second, 'cap', WHERE)), 'sold_out');
  assert.equal(balanceOf(db, second.id), 30, 'a refused order costs nothing');
});

test('a creator can take a new order back: coins and stock return, and it can be ordered again', () => {
  const first = db.prepare('SELECT * FROM users WHERE id = 2').get() as UserRow;
  const order = myOrders(db, 2).orders[0]!;
  assert.equal(order.status, 'new');
  assert.equal(order.canCancel, true);
  assert.equal(order.imageUrl, PHOTO_A);
  assert.equal(cancelOrder(db, first, order.id), 30);
  assert.equal(listItems(db).items.find((item) => item.id === 'cap')!.stock, 1);
  assert.equal(codeOf(() => cancelOrder(db, first, order.id)), 'too_late', 'a second cancel refunds nothing');
  assert.equal(balanceOf(db, 2), 30);
  assert.equal(myOrders(db, 2).orders[0]!.status, 'cancelled');
  assert.equal(codeOf(() => cancelOrder(db, db.prepare('SELECT * FROM users WHERE id = 3').get() as UserRow, order.id)), 'order_not_found', 'not someone else\'s order');
});

test('once the team packed an order only the team can cancel it, with a reason the creator is told', () => {
  const buyer = db.prepare('SELECT * FROM users WHERE id = 3').get() as UserRow;
  const { orderId } = placeOrder(db, buyer, 'cap', WHERE);
  advanceOrder(db, 900, orderId, 'new');
  assert.equal(codeOf(() => cancelOrder(db, buyer, orderId)), 'too_late');
  outbox.length = 0;
  cancelOrderByTeam(db, 900, orderId, 'The last cap arrived damaged');
  assert.equal(balanceOf(db, 3), 30);
  assert.equal(listItems(db).items.find((item) => item.id === 'cap')!.stock, 1);
  assert.ok(outbox.some((message) => message.chatId === 3 && message.html.includes('The last cap arrived damaged')));
  assert.equal(codeOf(() => cancelOrderByTeam(db, 900, orderId, 'Again')), 'already_moved');
  const cancelled = listOrders(db, 'cancelled', { page: 1, pageSize: 25, offset: 0 });
  assert.equal(cancelled.counts.cancelled, 2);
  assert.equal(cancelled.rows[0]!.cancelNote, 'The last cap arrived damaged');
  assert.equal(cancelled.rows[0]!.imageUrl, PHOTO_A);
});

test('a limit per creator, sizes, and an item that is sent in Telegram', () => {
  const tickets = createItem(db, 900, input({ title: 'Cinema night', images: [], delivery: 'message', perCreator: 1, price: 5 }));
  const tee = createItem(db, 900, input({ title: 'Tee', images: [PHOTO_A], sizes: ['M', 'L'], price: 5 }));
  const fan = creator(4, 40);
  // No address is asked for something that is sent as a message.
  placeOrder(db, fan, tickets.id, {});
  assert.equal(codeOf(() => placeOrder(db, fan, tickets.id, {})), 'limit_reached');
  assert.equal(shop(db, fan.id).items.find((item) => item.id === tickets.id)!.blocked, 'limit');
  assert.equal(codeOf(() => placeOrder(db, fan, tee.id, { ...WHERE, size: 'S' })), 'size_required', 'only the sizes on offer');
  assert.equal(codeOf(() => placeOrder(db, fan, tee.id, { size: 'M' })), 'address_required');
  placeOrder(db, fan, tee.id, { ...WHERE, size: 'M' });
  assert.equal(shop(db, fan.id).openOrders, 2);
  assert.equal(shop(db, creator(5, 0).id).items.find((item) => item.id === tee.id)!.blocked, 'coins');
});

test('a hidden item can be opened by the team to check it, and by nobody else; it cannot be ordered', () => {
  const draft = createItem(db, 900, input({ title: 'Secret drop', visible: false }));
  creator(900, 100);
  assert.equal(shop(db, 4).items.some((item) => item.id === draft.id), false);
  assert.equal(shop(db, 4, draft.id).items.some((item) => item.id === draft.id), false, 'a creator cannot preview');
  const seen = shop(db, 900, draft.id).items.find((item) => item.id === draft.id)!;
  assert.equal(seen.blocked, 'hidden');
  assert.equal(codeOf(() => placeOrder(db, db.prepare('SELECT * FROM users WHERE id = 900').get() as UserRow, draft.id, WHERE)), 'item_not_found');
});

test('the team sets the order of the shelf; an item with orders is hidden, never removed', () => {
  reorder(db, 900, ['tee', 'cap']);
  const ids = shop(db, 4).items.map((item) => item.id);
  assert.deepEqual(ids.slice(0, 2), ['tee', 'cap']);
  assert.equal(codeOf(() => removeItem(db, 900, 'cap')), 'has_orders');
  removeItem(db, 900, 'cap-2');
  assert.equal(listItems(db).items.some((item) => item.id === 'cap-2'), false);
});
