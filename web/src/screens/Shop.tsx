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

function ItemCard({ item, balance }: { item: ShopItemView; balance: number }) {
  const missing = item.price - balance;
  const inner = (
    <>
      <Cover src={item.imageUrl} alt={`${item.title} photo`} style={{ height: 116, borderRadius: 14 }} />
      <div className="stack" style={{ gap: 2, padding: '0 4px 4px' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{item.title}</div>
        <div className="nums" style={{ fontSize: 15, fontWeight: 800, color: missing > 0 ? 'var(--ink)' : 'var(--red-dark)' }}>
          {coins(item.price)}
        </div>
        {missing > 0 ? (
          <div className="muted nums" style={{ fontSize: 12, fontWeight: 600 }}>
            {coins(missing).replace(' ', ' more ')} to go
          </div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>You can get it</div>
        )}
      </div>
    </>
  );
  const style = { padding: 10, gap: 8 };
  // Items out of reach are not links: they only show how many coins are missing.
  return missing > 0 ? (
    <div className="card card--col" style={style}>
      {inner}
    </div>
  ) : (
    <Link to={`/shop/${item.id}`} className="card card--col" style={style}>
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
            <span className="chip nums" style={{ padding: '8px 12px', borderRadius: 14, background: 'var(--white)', color: 'var(--red-dark)', fontSize: 15, fontWeight: 800 }}>
              {coins(data.balance)}
            </span>
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
          <div className="grid2">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} balance={data.balance} />
            ))}
          </div>
        ) : (
          <div className="empty">Nothing here yet. New items are on the way.</div>
        )}
      </main>
      <TabBar active="/wallet" />
    </Screen>
  );
}
