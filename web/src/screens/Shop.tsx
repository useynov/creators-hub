import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { ShopItemView, ShopView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Cover, HubHeader, Loading, Problem, Screen, TabBar } from '../components/ui';
import { coins, dayLong, monthName, price } from '../format';
import { useHub } from '../hub';

type Filter = 'all' | 'merch' | 'gift';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['merch', 'Merch'],
  ['gift', 'Gifts'],
];

const TONES = ['red', 'black', 'cream', 'line'] as const;
/** The colour of an item without a photo: by its place on the shelf, so neighbours differ and the item page matches the grid. */
export const toneOf = (place: number): (typeof TONES)[number] => TONES[Math.max(0, place) % TONES.length]!;

/**
 * The picture of an item: its first photo, or, while it has none, a flat colour tile with the
 * name set big. A made-up product photo would be a promise we cannot keep.
 */
export function ItemFace({ item, place = 0, big }: { item: Pick<ShopItemView, 'title' | 'imageUrl' | 'category'>; place?: number; big?: boolean }) {
  if (item.imageUrl) return <Cover src={item.imageUrl} alt={`${item.title} photo`} eager={big} />;
  return (
    <div className={`block block--${toneOf(place)}`} style={big ? { padding: 20, justifyContent: 'flex-end' } : undefined}>
      {!big && (
        <span className="t-cap" style={{ fontWeight: 600, opacity: 0.8 }}>
          {item.category === 'gift' ? 'Gift' : 'Merch'}
        </span>
      )}
      <span className="block__word" style={big ? { fontSize: 56 } : undefined}>
        {item.title}
      </span>
    </div>
  );
}

/** One short line under an item: can I have it, and if not, why. */
export function itemState(item: ShopItemView): { text: string; tone: 'ok' | 'quiet' | 'warn' } {
  if (item.blocked === 'hidden') return { text: 'Hidden from creators', tone: 'warn' };
  if (item.blocked === 'sold_out') return { text: 'Sold out', tone: 'quiet' };
  if (item.blocked === 'limit') return { text: item.perCreator === 1 ? 'You already ordered it' : `Limit of ${item.perCreator} reached`, tone: 'quiet' };
  if (item.blocked === 'month') return { text: item.nextOn ? `Next one from ${dayLong(item.nextOn)}` : 'Next one next month', tone: 'quiet' };
  if (item.blocked === 'account') return { text: 'Opens once your account is confirmed', tone: 'quiet' };
  if (item.blocked === 'coins') return { text: `${coins(item.missing).replace(' ', ' more ')} to go`, tone: 'quiet' };
  if (item.left !== null && item.left <= 5) return { text: item.left === 1 ? 'Last one' : `Only ${item.left} left`, tone: 'warn' };
  if (item.price === 0) return { text: item.perMonth === 1 ? 'Yours once a month' : 'Yours for free', tone: 'ok' };
  return { text: 'You can get it', tone: 'ok' };
}
export const STATE_COLOR = { ok: 'var(--green)', quiet: 'var(--muted)', warn: 'var(--amber)' } as const;

/** Every item opens its own page, also the ones still out of reach: looking is free. */
function ItemCard({ item, place }: { item: ShopItemView; place: number }) {
  const state = itemState(item);
  return (
    <Link to={`/shop/${item.id}`} className={`shelf${item.blocked === 'sold_out' ? ' shelf--out' : ''}`}>
      <div className="shelf__face">
        <ItemFace item={item} place={place} />
        {item.blocked === 'sold_out' && <span className="chip chip--ink chip--sm shelf__flag">Sold out</span>}
      </div>
      <div className="stack" style={{ gap: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', lineHeight: 1.3 }}>{item.title}</div>
        <div className="nums" style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>
          {price(item.price)}
        </div>
        <div className="nums t-cap" style={{ fontWeight: state.tone === 'quiet' ? 400 : 600, color: STATE_COLOR[state.tone] }}>
          {state.text}
        </div>
      </div>
    </Link>
  );
}

/**
 * Something the Hub gives for free, once a month: a wide card at the top of the shop. It says
 * what there is to choose from, and whether this month's is still there to take.
 */
function FreeCard({ item }: { item: ShopItemView }) {
  const state = itemState(item);
  const taken = item.blocked === 'month';
  return (
    <Link to={`/shop/${item.id}`} className={`freecard${item.blocked ? ' freecard--off' : ''}`}>
      <div className="freecard__face">{item.imageUrl ? <Cover src={item.imageUrl} alt={`${item.title} photo`} fill eager /> : <div className="block block--red" aria-hidden="true" />}</div>
      <div className="freecard__body">
        <span className="label">{item.perMonth === 1 ? `Free · ${monthName()}` : 'Free'}</span>
        <span className="freecard__title">{item.title}</span>
        {item.sizes.length > 0 && <span className="t-sm muted">{item.sizes.join(' · ')}</span>}
        {item.blocked === null ? (
          <span className="tcard__btn tcard__btn--red">{item.perMonth === 1 ? 'Get this month\'s' : 'Get it free'}</span>
        ) : (
          <span className="t-sm nums" style={{ fontWeight: 600, color: taken ? 'var(--green)' : STATE_COLOR[state.tone] }}>
            {taken ? `You have ${monthName()}'s. ${state.text}.` : state.text}
          </span>
        )}
      </div>
    </Link>
  );
}

/** The Shop tab: what the Hub gives for free, then merch and gifts priced in coins, the creator's orders and their wallet. */
export function Shop() {
  const { me, settings } = useHub();
  const { data, error, mutate } = useSWR<ShopView>('/api/shop');
  const [filter, setFilter] = useState<Filter>('all');
  const free = data?.items.filter((item) => item.price === 0) ?? [];
  const paid = data?.items.filter((item) => item.price > 0) ?? [];
  const items = paid.filter((item) => filter === 'all' || item.category === filter);
  const kinds = new Set(paid.map((item) => item.category));

  return (
    <Screen>
      <HubHeader brandName={settings.brandName} balance={data?.balance ?? me.balance} />
      <main className="body body--tabs" style={{ paddingTop: 24, gap: 20 }}>
        <h1 className="display t-display">Shop</h1>
        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            {data.openOrders > 0 && (
              <Link to="/shop/orders" className="card card--row card--flat" style={{ gap: 12, padding: '14px 16px' }}>
                <Icon name="gift" />
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--black)' }}>
                  {data.openOrders} {data.openOrders === 1 ? 'order is' : 'orders are'} on the way
                </span>
                <Icon name="right" size={20} color="var(--muted)" />
              </Link>
            )}

            {free.map((item) => (
              <FreeCard key={item.id} item={item} />
            ))}

            {kinds.size > 1 && (
              <div className="pills" role="group" aria-label="Filter">
                {FILTERS.map(([key, label]) => (
                  <button key={key} type="button" className="pill" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {items.length ? (
              <div className="grid2" style={{ rowGap: 28 }}>
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} place={data.items.indexOf(item)} />
                ))}
              </div>
            ) : (
              !free.length && <p className="empty">Nothing here yet. New items are on the way.</p>
            )}

            <div className="menu" style={{ marginTop: 4 }}>
              <Link to="/shop/orders">
                <Icon name="gift" size={22} />
                <span className="menu__label">Your orders</span>
                <Icon name="right" size={18} color="var(--muted)" />
              </Link>
              <Link to="/wallet">
                <Icon name="coin" size={22} />
                <span className="menu__label">
                  Your coins
                  <small>Balance, history and cash-out</small>
                </span>
                <span className="menu__value nums">{coins(data.balance)}</span>
                <Icon name="right" size={18} color="var(--muted)" />
              </Link>
            </div>
          </>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}
