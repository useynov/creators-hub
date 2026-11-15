import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { LedgerRow, WalletView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, TabBar } from '../components/ui';
import { coins, day, signed } from '../format';
import { useHub } from '../hub';

const KIND: Record<LedgerRow['kind'], string> = {
  task: 'task approved',
  order: 'shop order',
  bonus: 'bonus from the team',
  event: 'event check-in',
  cashout: 'cash-out request',
};

/** Coin balance, every earning and spend, and the two ways to use coins. */
export function Wallet() {
  const { me } = useHub();
  const { data, error, mutate } = useSWR<WalletView>('/api/wallet');
  const locked = me.level === 'member';

  return (
    <Screen top="red">
      <section className="hero hero--round stack" style={{ padding: '28px 20px 24px', gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Your balance</div>
          <h1 className="display nums" style={{ fontSize: 60, lineHeight: 1 }}>
            {coins(data?.balance ?? me.balance)}
          </h1>
        </div>
        <div className="grid2" style={{ gap: 10 }}>
          <Link to="/shop" className="btn btn--md btn--white">
            Spend in shop
          </Link>
          <Link to="/cashout" className="btn btn--md btn--ghost" style={{ gap: 8 }}>
            {locked && <Icon name="lock" size={18} stroke={2.4} />}
            <span>Cash out</span>
          </Link>
        </div>
      </section>

      <main className="body body--tabs" style={{ gap: 10, paddingTop: 20 }}>
        <h2 className="eyebrow">History</h2>
        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : data.history.length ? (
          <ul className="rows" style={{ margin: 0, padding: '4px 16px', listStyle: 'none' }}>
            {data.history.map((row) => (
              <li key={row.id} className="row" style={{ alignItems: 'center', padding: '14px 0' }}>
                <div className="stack" style={{ gap: 2, color: 'var(--ink)' }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{row.title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {day(row.createdAt)} · {KIND[row.kind]}
                  </div>
                </div>
                <div className="nums" style={{ fontSize: 17, fontWeight: 800, color: row.amount > 0 ? 'var(--green)' : 'var(--ink)' }}>
                  {signed(row.amount)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card empty">No coins yet. Your first approved task lands here.</div>
        )}
        <p className="note" style={{ paddingTop: 4 }}>
          {locked
            ? 'Coins come from approved tasks. Spend them on merch and gifts now. Cash-out opens at Pro level.'
            : 'Coins come from approved tasks. Spend them on merch and gifts, or cash them out.'}
        </p>
      </main>
      <TabBar />
    </Screen>
  );
}
