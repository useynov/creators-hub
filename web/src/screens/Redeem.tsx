import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { ShopView } from '../../../server/src/types';
import { api } from '../api';
import { Cover, Loading, Problem, Screen, TopBar } from '../components/ui';
import { coins } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';

export const SIZES = ['S', 'M', 'L', 'XL'];

/** The first order asks for size, address and phone, then saves them to the profile. */
export function Redeem() {
  const { id = '' } = useParams();
  const { me, refresh } = useHub();
  const navigate = useNavigate();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data, error, mutate: reload } = useSWR<ShopView>('/api/shop');
  const item = data?.items.find((candidate) => candidate.id === id);

  const [size, setSize] = useState(me.size ?? '');
  const [address, setAddress] = useState(me.address ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');

  const [order, ordering] = useAction(async () => {
    await api.post(`/api/shop/${id}/order`, { size, address, phone });
    await Promise.all([refresh(), mutate('/api/shop'), mutate('/api/wallet')]);
    buzz('success');
    toast('Order placed. We will contact you about the delivery.');
    navigate('/wallet', { replace: true });
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    order();
  };

  if (!data || !item) {
    return (
      <Screen>
        <TopBar back="/shop" backLabel="Back to shop" title="Your order" />
        {error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : data ? (
          <div className="empty">This item is no longer in the shop.</div>
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const after = data.balance - item.price;
  const ready = after >= 0 && address.trim() && phone.trim() && (!item.needsSize || size);

  return (
    <Screen>
      <TopBar back="/shop" backLabel="Back to shop" title="Your order" />
      <form className="body" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="card card--row" style={{ gap: 14, padding: 12 }}>
          <Cover src={item.imageUrl} alt={`${item.title} photo`} style={{ width: 84, height: 84, borderRadius: 14, flexShrink: 0 }} />
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="display" style={{ fontSize: 22 }}>
              {item.title}
            </h1>
            <div className="nums" style={{ fontSize: 17, fontWeight: 800, color: 'var(--red-dark)' }}>
              {coins(item.price)}
            </div>
          </div>
        </div>

        <div className="form">
          {item.needsSize && (
            <fieldset className="field">
              <legend>Size</legend>
              <div className="sizes">
                {SIZES.map((option) => (
                  <button key={option} type="button" className="pill" aria-pressed={size === option} onClick={() => setSize(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
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
            <input
              id="phone"
              className="input"
              type="tel"
              autoComplete="tel"
              placeholder="+7"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
          We ask this once and save it to your profile for next time.
        </p>

        <div className="spacer" />
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
            <span className="muted">Balance after this order</span>
            <span className="nums" style={{ fontWeight: 800 }}>
              {after >= 0 ? coins(after) : `${coins(-after).replace(' ', ' more ')} needed`}
            </span>
          </div>
          <button type="submit" className="btn" disabled={ordering || !ready}>
            Order for {coins(item.price)}
          </button>
        </div>
      </form>
    </Screen>
  );
}
