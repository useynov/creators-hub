import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { ShopItemView, ShopView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Cover, Loading, Problem, Screen, TabBar, TopBar } from '../components/ui';
import { coins } from '../format';

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
  if (item.blocked === 'coins') return { text: `${coins(item.missing).replace(' ', ' more ')} to go`, tone: 'quiet' };
  if (item.left !== null && item.left <= 5) return { text: item.left === 1 ? 'Last one' : `Only ${item.left} left`, tone: 'warn' };
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
          {coins(item.price)}
        </div>
        <div className="nums t-cap" style={{ fontWeight: state.tone === 'quiet' ? 400 : 600, color: STATE_COLOR[state.tone] }}>
          {state.text}
        </div>
      </div>
    </Link>
  );
}

/** Merch and gifts priced in coins. */
export function Shop() {
  const { data, error, mutate } = useSWR<ShopView>('/api/shop');
  const [filter, setFilter] = useState<Filter>('all');
  const items = data?.items.filter((item) => filter === 'all' || item.category === filter) ?? [];
  const kinds = new Set(data?.items.map((item) => item.category));

  return (
    <Screen>
      <TopBar back="/wallet" backLabel="Back to wallet" title="Shop" heading right={data && <span className="chip chip--line nums">{coins(data.balance)}</span>} />
      <main className="body body--tabs" style={{ gap: 20 }}>
        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <Link to="/shop/orders" className="card card--row card--flat" style={{ gap: 12, padding: '14px 16px' }}>
              <Icon name="gift" />
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--black)' }}>
                {data.openOrders ? `${data.openOrders} ${data.openOrders === 1 ? 'order is' : 'orders are'} on the way` : 'Your orders'}
              </span>
              <Icon name="right" size={20} color="var(--muted)" />
            </Link>

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
              <p className="empty">Nothing here yet. New items are on the way.</p>
            )}
          </>
        )}
      </main>
      <TabBar active="/wallet" />
    </Screen>
  );
}
