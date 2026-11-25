import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { ShopView } from '../../../server/src/types';
import { api } from '../api';
import { Loading, Problem, Screen, TopBar } from '../components/ui';
import { coins, dayLong, price } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';
import { ItemFace } from './Shop';

/** Clothing sizes the profile offers. An item of the shop brings its own list. */
export const SIZES = ['S', 'M', 'L', 'XL'];

/**
 * The order itself: the size if the item has sizes, where to bring it if a courier brings it,
 * and what it costs. Address and phone are asked once and kept in the profile.
 */
export function Redeem() {
  const { id = '' } = useParams();
  const { me, refresh } = useHub();
  const navigate = useNavigate();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data, error, mutate: reload } = useSWR<ShopView>('/api/shop');
  const item = data?.items.find((candidate) => candidate.id === id);

  const [picked, setSize] = useState(me.size ?? '');
  const [address, setAddress] = useState(me.address ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');

  const [order, ordering] = useAction(async () => {
    await api.post(`/api/shop/${id}/order`, { size: item?.sizes.length === 1 ? item.sizes[0] : picked, address, phone });
    await Promise.all([refresh(), mutate('/api/shop'), mutate('/api/shop/orders'), mutate('/api/wallet')]);
    buzz('success');
    toast('Order placed. Follow it here.');
    navigate('/shop/orders', { replace: true });
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    order();
  };

  if (!data || !item) {
    return (
      <Screen>
        <TopBar back="/shop" backLabel="Back to shop" title="Your order" />
        {error ? <Problem error={error} onRetry={() => void reload()} /> : data ? <p className="empty">This item is no longer in the shop.</p> : <Loading />}
      </Screen>
    );
  }

  // With one size on offer there is nothing to choose. The size kept in the profile is only
  // a start for clothes: a drink is picked anew each time.
  const size = item.sizes.length === 1 ? item.sizes[0]! : item.sizes.includes(picked) ? picked : '';
  const free = item.price === 0;
  const courier = item.delivery === 'courier';
  const sizeOk = !item.sizes.length || item.sizes.includes(size);
  const whereOk = !courier || (address.trim().length > 0 && phone.replace(/\D/g, '').length >= 7);
  const after = data.balance - item.price;
  const ready = item.blocked === null && sizeOk && whereOk;
  // One line that says what is still missing, instead of a button that is silently grey.
  const missing =
    item.blocked === 'sold_out'
      ? 'This one is sold out.'
      : item.blocked === 'limit'
        ? 'You already ordered this one.'
        : item.blocked === 'month'
          ? `You already had this month's.${item.nextOn ? ` The next one is yours from ${dayLong(item.nextOn)}.` : ''}`
          : item.blocked === 'account'
            ? 'This one opens once the team has confirmed your account.'
            : item.blocked === 'coins'
          ? `You need ${coins(item.missing)} more.`
          : !sizeOk
            ? item.clothing
              ? 'Choose a size.'
              : `Choose your ${item.sizeLabel.toLowerCase()}.`
            : !whereOk
              ? 'Add the address and a phone for the courier.'
              : null;

  return (
    <Screen>
      <TopBar back={`/shop/${item.id}`} backLabel="Back to the item" title="Your order" />
      <form className="body" style={{ gap: 24 }} onSubmit={submit} noValidate>
        <div className="order__head">
          <div className="order__thumb" style={{ width: 84, height: 84 }}>
            {item.imageUrl ? <ItemFace item={item} /> : <div className="block block--red" aria-hidden="true" />}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h1 className="display" style={{ fontSize: 26 }}>
              {item.title}
            </h1>
            <div className="nums" style={{ fontSize: 16, fontWeight: 600, color: 'var(--black)' }}>
              {price(item.price)}
            </div>
          </div>
        </div>

        <div className="form">
          {item.sizes.length > 0 && (
            <fieldset className="field">
              <legend>{item.sizeLabel}</legend>
              <div className="sizes" style={{ gridTemplateColumns: `repeat(${item.clothing ? Math.min(4, item.sizes.length) : 2}, minmax(0, 1fr))` }}>
                {item.sizes.map((option) => (
                  <button key={option} type="button" className="pill" aria-pressed={size === option} onClick={() => setSize(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {courier ? (
            <>
              <div className="field">
                <label htmlFor="addr">Delivery address</label>
                <input
                  id="addr"
                  className="input"
                  autoComplete="street-address"
                  placeholder="City, street, building, apartment"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone for the courier</label>
                <input id="phone" className="input" type="tel" autoComplete="tel" placeholder="+7" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              <p className="note">A courier brings it for free. We keep the address and phone in your profile for next time.</p>
            </>
          ) : (
            <div className="hint hint--soft">
              <span>No address needed: we send this one to you in Telegram.</span>
            </div>
          )}
        </div>

        <div className="dock stack" style={{ gap: 12 }}>
          {!free && (
          <dl className="rows" style={{ margin: 0, borderTop: 0 }}>
            <div className="row" style={{ paddingTop: 0 }}>
              <dt>Your balance</dt>
              <dd className="nums" style={{ margin: 0 }}>
                {coins(data.balance)}
              </dd>
            </div>
            <div className="row" style={{ borderBottom: 0, paddingBottom: 0 }}>
              <dt>After this order</dt>
              <dd className="nums" style={{ margin: 0 }}>
                {after >= 0 ? coins(after) : 'not enough coins'}
              </dd>
            </div>
          </dl>
          )}
          <button type="submit" className="btn" disabled={ordering || !ready}>
            {free ? 'Confirm, it is free' : `Confirm for ${coins(item.price)}`}
          </button>
          {missing && (
            <p className="note" style={{ textAlign: 'center' }} role="status">
              {missing}
            </p>
          )}
        </div>
      </form>
    </Screen>
  );
}
