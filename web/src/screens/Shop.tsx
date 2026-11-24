import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { ShopItemView, ShopView } from '../../../server/src/types';
import { Cover, Loading, Problem, Screen, TabBar, TopBar } from '../components/ui';
import { coins } from '../format';

type Filter = 'all' | 'merch' | 'gift';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['merch', 'Merch'],
  ['gift', 'Gifts'],
];

const TONES = ['red', 'black', 'cream', 'line'] as const;

/**
 * A piece of merch as a flat colour tile with its name set big. We have no product photos yet,
 * and a made-up one would be a promise we cannot keep. When a real photo is added it takes the tile.
 */
function ItemCard({ item, balance, index }: { item: ShopItemView; balance: number; index: number }) {
  const missing = item.price - balance;
  const inner = (
    <>
      {item.imageUrl ? (
        <Cover src={item.imageUrl} alt={`${item.title} photo`} style={{ aspectRatio: '1 / 1', borderRadius: 20 }} />
      ) : (
        <div className={`block block--${TONES[index % TONES.length]}`} style={{ aspectRatio: '1 / 1' }}>
          <span className="t-cap" style={{ fontWeight: 600, opacity: 0.8 }}>
            {item.category === 'gift' ? 'Gift' : 'Merch'}
          </span>
          <span className="block__word">{item.title}</span>
        </div>
      )}
      <div className="stack" style={{ gap: 2 }}>
        <div className="nums" style={{ fontSize: 16, fontWeight: 700, color: 'var(--black)' }}>
          {coins(item.price)}
        </div>
        {missing > 0 ? (
          <div className="muted nums t-cap">{coins(missing).replace(' ', ' more ')} to go</div>
        ) : (
          <div className="t-cap" style={{ fontWeight: 600, color: 'var(--green)' }}>
            You can get it
          </div>
        )}
      </div>
    </>
  );
  const style = { gap: 10, color: 'inherit' };
  // Items out of reach are not links: they only show how many coins are missing.
  return missing > 0 ? (
    <div className="stack" style={style}>
      {inner}
    </div>
  ) : (
    <Link to={`/shop/${item.id}`} className="stack" style={style}>
      {inner}
    </Link>
  );
}

/** Merch and gifts priced in coins. */
export function Shop() {
  const { data, error, mutate } = useSWR<ShopView>('/api/shop');
  const [filter, setFilter] = useState<Filter>('all');
  const items = data?.items.filter((item) => filter === 'all' || item.category === filter) ?? [];

  return (
    <Screen>
      <TopBar
        back="/wallet"
        backLabel="Back to wallet"
        title="Shop"
        heading
        right={
          data && (
            <span className="chip chip--line nums">{coins(data.balance)}</span>
          )
        }
      />
      <main className="body body--tabs">
        <div className="pills" role="group" aria-label="Filter">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" className="pill" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : items.length ? (
          <div className="grid2" style={{ rowGap: 24 }}>
            {items.map((item, index) => (
              <ItemCard key={item.id} item={item} balance={data.balance} index={index} />
            ))}
          </div>
        ) : (
          <p className="empty">Nothing here yet. New items are on the way.</p>
        )}
      </main>
      <TabBar active="/wallet" />
    </Screen>
  );
}
