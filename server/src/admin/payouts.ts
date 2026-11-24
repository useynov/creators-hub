// Cash-out requests. The coins left the creator's balance when they asked (service.ts).
// The Owner marks a request paid, or rejects it and the coins come back through the ledger.
// The Manager sees the list read-only. The Viewer has no access.

import type { Hono } from 'hono';
import { settings } from '../config.js';
import { now, type CashoutRow, type DB } from '../db.js';
import { esc, notifyUser } from '../notify.js';
import { getUser, levelOf, ratingOf } from '../service.js';
import { audit } from './audit.js';
import { allow, OWNER, STAFF, type AdminEnv } from './auth.js';
import { bad, idParam, pageParams, queryOneOf, readJson, text } from './input.js';
import type { PayoutList, PayoutStatus } from './types.js';

export const PAYOUT_STATUSES: readonly PayoutStatus[] = ['new', 'paid', 'rejected'];

const money = (coins: number): number | null => (settings.cashout.rateKzt ? coins * settings.cashout.rateKzt : null);

export function listPayouts(db: DB, status: PayoutStatus, page: { page: number; pageSize: number; offset: number }, canDecide: boolean): PayoutList {
  const counts = Object.fromEntries(PAYOUT_STATUSES.map((s) => [s, 0])) as Record<PayoutStatus, number>;
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM cashouts GROUP BY status').all() as Array<{ status: PayoutStatus; n: number }>) {
    if (row.status in counts) counts[row.status] = row.n;
  }
  const rows = db
    .prepare(`SELECT * FROM cashouts WHERE status = ? ORDER BY id ${status === 'new' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`)
    .all(status, page.pageSize, page.offset) as CashoutRow[];
  return {
    rows: rows.map((row) => {
      const user = getUser(db, row.user_id)!;
      return {
        id: row.id,
        creator: { id: row.user_id, name: user.first_name, instagram: user.instagram },
        level: levelOf(user, ratingOf(db, row.user_id)),
        coins: row.coins,
        amount: money(row.coins),
        details: row.details,
        status: row.status,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
        note: row.note,
      };
    }),
    total: counts[status],
    page: page.page,
    pageSize: page.pageSize,
    counts,
    canDecide,
  };
}

function getPayout(db: DB, id: number): CashoutRow {
  const row = db.prepare('SELECT * FROM cashouts WHERE id = ?').get(id) as CashoutRow | undefined;
  if (!row) throw bad('not_found', 'This request does not exist.', 404);
  return row;
}

/**
 * Marks a request paid. Only a request that is still open changes, so a second press (or a
 * colleague pressing at the same time) cannot pay twice or message the creator twice.
 */
export function markPaid(db: DB, actorId: number, id: number, note: string | null): void {
  const payout = getPayout(db, id);
  const changed = db.transaction(() => {
    const changes = db
      .prepare(`UPDATE cashouts SET status = 'paid', decided_at = ?, decided_by = ?, note = ? WHERE id = ? AND status = 'new'`)
      .run(now(), actorId, note, id).changes;
    if (changes) audit(db, actorId, 'payout.paid', id, `${payout.coins} coins`);
    return changes > 0;
  })();
  if (!changed) throw bad('already_decided', 'This request has already been decided.', 409);
  const amount = money(payout.coins);
  void notifyUser(
    payout.user_id,
    `<b>Cash-out sent.</b> ${payout.coins} coins${amount ? ` = ${amount.toLocaleString('en-US')} ${esc(settings.currencySign)}` : ''} are on their way to you.`,
  );
}

/**
 * Rejects a request and gives the coins back, in one transaction: the status change and the
 * refund happen together or not at all, and only once.
 */
export function rejectPayout(db: DB, actorId: number, id: number, note: string): void {
  const payout = getPayout(db, id);
  const changed = db.transaction(() => {
    const changes = db
      .prepare(`UPDATE cashouts SET status = 'rejected', decided_at = ?, decided_by = ?, note = ? WHERE id = ? AND status = 'new'`)
      .run(now(), actorId, note, id).changes;
    if (!changes) return false;
    const refunded = db.prepare(`SELECT 1 FROM ledger WHERE kind = 'cashout' AND ref = ? AND amount > 0`).get(String(id));
    if (!refunded) {
      db.prepare(`INSERT INTO ledger (user_id, amount, title, kind, ref, created_at) VALUES (?, ?, 'Cash-out returned', 'cashout', ?, ?)`).run(
        payout.user_id,
        payout.coins,
        String(id),
        now(),
      );
    }
    audit(db, actorId, 'payout.rejected', id, `${payout.coins} coins returned`);
    return true;
  })();
  if (!changed) throw bad('already_decided', 'This request has already been decided.', 409);
  void notifyUser(
    payout.user_id,
    `<b>Cash-out declined.</b> ${payout.coins} coins are back in your wallet.\n\nFrom the team: ${esc(note)}`,
    { text: 'Open my wallet', path: '/wallet' },
  );
}

export function payoutRoutes(api: Hono<AdminEnv>, db: DB): void {
  api.get('/payouts', allow(...STAFF), (c) =>
    c.json(listPayouts(db, queryOneOf(c.req.query('status'), PAYOUT_STATUSES, 'new'), pageParams(c), c.get('actor').role === 'owner')),
  );

  api.post('/payouts/:id/paid', allow(...OWNER), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    markPaid(db, c.get('actor').id, id, text(body.note, 'note', { max: 500 }));
    return c.json({ ok: true });
  });

  api.post('/payouts/:id/reject', allow(...OWNER), async (c) => {
    const id = idParam(c.req.param('id'));
    const body = await readJson(c);
    rejectPayout(db, c.get('actor').id, id, text(body.note, 'note', { max: 500, required: true })!);
    return c.json({ ok: true });
  });
}
