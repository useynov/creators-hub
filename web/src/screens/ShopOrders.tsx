import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { MyOrdersView, MyOrderView } from '../../../server/src/types';
import { api } from '../api';
import { Loading, Problem, Screen, TopBar } from '../components/ui';
import { coins, day } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';
import { ItemFace } from './Shop';

const STEPS = ['new', 'packed', 'shipped', 'delivered'] as const;
/** The same four steps read differently for a parcel and for something sent as a message. */
const LABELS: Record<MyOrderView['delivery'], Record<(typeof STEPS)[number], string>> = {
  courier: { new: 'Ordered', packed: 'Packed', shipped: 'On its way', delivered: 'Delivered' },
  message: { new: 'Ordered', packed: 'Being prepared', shipped: 'Sent to you', delivered: 'Received' },
};
const NOW: Record<MyOrderView['delivery'], Record<(typeof STEPS)[number], string>> = {
  courier: {
    new: 'We got your order and will pack it soon.',
    packed: 'Packed. A courier will pick it up soon.',
    shipped: 'With the courier. They will call the number you gave.',
    delivered: 'Delivered. Enjoy it.',
  },
  message: {
    new: 'We got your order.',
    packed: 'We are preparing it.',
    shipped: 'Sent. Look for a message from the team in Telegram.',
    delivered: 'Done. Enjoy it.',
  },
};

function Order({ order, onChange }: { order: MyOrderView; onChange: () => Promise<unknown> }) {
  const { refresh } = useHub();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const [asking, setAsking] = useState(false);
  const [cancel, cancelling] = useAction(async () => {
    await api.post(`/api/shop/orders/${order.id}/cancel`);
    await Promise.all([onChange(), refresh(), mutate('/api/shop'), mutate('/api/wallet')]);
    buzz('success');
    toast(order.price > 0 ? `Order cancelled. ${coins(order.price)} are back on your balance.` : 'Order cancelled.');
  });

  const cancelled = order.status === 'cancelled';
  const at = cancelled ? -1 : STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const face = { id: order.itemId, title: order.title, imageUrl: order.imageUrl, category: 'merch' as const };

  return (
    <li className="order">
      <div className="order__head">
        <Link to={`/shop/${order.itemId}`} className="order__thumb" aria-label={`Open ${order.title}`}>
          {order.imageUrl ? <ItemFace item={face} /> : <div className="block block--red" aria-hidden="true" />}
        </Link>
        <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--black)' }}>
            {order.title}
            {order.size ? `, ${order.size}` : ''}
          </div>
          <div className="t-sm muted nums">
            Order {order.id} · {day(order.createdAt)} · {order.price > 0 ? coins(order.price) : 'free'}
          </div>
        </div>
      </div>

      {cancelled ? (
        <div className="hint hint--soft">
          <span>
            <strong>Cancelled{order.cancelledBy === 'team' ? ' by the team' : ''}.</strong>
            {order.price > 0 ? ` ${coins(order.price)} went back to your balance.` : ''}
            {order.cancelNote ? ` ${order.cancelNote}` : ''}
          </span>
        </div>
      ) : (
        <>
          <div className="track" role="list" aria-label="Where the order is">
            {STEPS.map((step, index) => (
              <div key={step} role="listitem" data-state={index < at ? 'done' : index === at ? 'now' : 'todo'} aria-current={index === at ? 'step' : undefined}>
                {LABELS[order.delivery][step]}
              </div>
            ))}
          </div>
          <p className="t-sm" style={{ color: 'var(--ink-2)' }}>
            {NOW[order.delivery][order.status as (typeof STEPS)[number]]}
            {order.delivery === 'courier' && order.address && order.status !== 'delivered' ? ` To: ${order.address}.` : ''}
          </p>
          {order.canCancel &&
            (asking ? (
              <div className="stack" style={{ gap: 8 }}>
                <button type="button" className="btn btn--md btn--outline" disabled={cancelling} onClick={() => cancel()}>
                  {order.price > 0 ? `Yes, cancel and get ${coins(order.price)} back` : 'Yes, cancel it'}
                </button>
                <button type="button" className="textlink" style={{ alignSelf: 'center' }} onClick={() => setAsking(false)}>
                  Keep the order
                </button>
              </div>
            ) : (
              <button type="button" className="textlink" style={{ alignSelf: 'flex-start', minHeight: 0 }} onClick={() => setAsking(true)}>
                Cancel this order
              </button>
            ))}
        </>
      )}
    </li>
  );
}

/** Everything the creator ordered, newest first, each with where it stands. */
export function ShopOrders() {
  const { data, error, mutate } = useSWR<MyOrdersView>('/api/shop/orders');
  return (
    <Screen>
      <TopBar back="/shop" backLabel="Back to shop" title="Your orders" heading />
      <main className="body" style={{ gap: 0, paddingTop: 0 }}>
        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : data.orders.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.orders.map((order) => (
              <Order key={order.id} order={order} onChange={() => mutate()} />
            ))}
          </ul>
        ) : (
          <div className="stack" style={{ gap: 16, paddingTop: 24 }}>
            <p className="muted" style={{ fontSize: 16 }}>
              No orders yet. Everything in the shop is paid with the coins you earn on tasks.
            </p>
            <Link to="/shop" className="btn btn--outline">
              Open the shop
            </Link>
          </div>
        )}
      </main>
    </Screen>
  );
}
