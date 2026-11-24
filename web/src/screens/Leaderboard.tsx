import { useState } from 'react';
import useSWR from 'swr';
import type { LeaderboardView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, TopBar } from '../components/ui';
import { coins, monthName, num } from '../format';
import { useHub } from '../hub';

type Period = 'month' | 'all';

/** Top creators of the month and the creator's own place. */
export function Leaderboard() {
  const { settings } = useHub();
  const [period, setPeriod] = useState<Period>('month');
  const { data, error, mutate } = useSWR<LeaderboardView>(`/api/leaderboard?period=${period}`);
  const scope = period === 'month' ? 'this month' : 'in total';

  return (
    <Screen>
      <TopBar back="/profile" backLabel="Back to profile" title="Leaderboard" />
      <main className="body">
        <div className="stack" style={{ gap: 10 }}>
          <h1 className="display t-display">Top creators</h1>
          <p className="muted" style={{ fontSize: 15 }}>
            {period === 'month' ? monthName() : 'All time'}, by views on Hub tasks
          </p>
        </div>
        <div role="tablist" aria-label="Period" className="segmented" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <button type="button" role="tab" aria-selected={period === 'month'} onClick={() => setPeriod('month')}>
            This month
          </button>
          <button type="button" role="tab" aria-selected={period === 'all'} onClick={() => setPeriod('all')}>
            All time
          </button>
        </div>

        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <section className="panel panel--red on-red" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 }}>
              <div className="index" style={{ fontSize: 48, color: 'var(--white)' }}>
                {data.me ? data.me.rank : '–'}
              </div>
              <div className="stack" style={{ flex: 1, gap: 2 }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>Your place</div>
                <div className="nums" style={{ fontSize: 14, fontWeight: 500 }}>
                  {data.me ? `${num(data.me.views)} views ${scope}` : `No approved posts ${scope} yet`}
                </div>
              </div>
            </section>

            {data.top.length ? (
              <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.top.map((row) => {
                  const first = row.rank === 1;
                  return (
                    <li key={row.rank} className="row" style={{ alignItems: 'center', padding: '12px 0', color: 'var(--black)' }}>
                      <div className="index" style={{ width: 30, fontSize: 24, color: first ? 'var(--red)' : 'var(--black)' }}>
                        {row.rank}
                      </div>
                      <div
                        className="avatar"
                        style={{ width: 40, height: 40, fontSize: 14, fontWeight: 700, background: first ? 'var(--black)' : 'var(--line-soft)', color: first ? 'var(--white)' : 'var(--black)' }}
                      >
                        {row.handle.replace(/^@/, '').charAt(0)}
                      </div>
                      <div className="stack" style={{ flex: 1, gap: 1, minWidth: 0, textAlign: 'left', fontWeight: 600 }}>
                        <div style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.handle}
                          {row.isMe ? ' (you)' : ''}
                        </div>
                        {first && period === 'month' && settings.topPerformerBonus ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>
                            <Icon name="trophy" size={14} stroke={2.2} />
                            <span>Gets the top performer bonus</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="nums" style={{ fontSize: 15, fontWeight: 700 }}>
                        {num(row.views)}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="empty" style={{ padding: '12px 0' }}>The board is empty so far. The first approved post takes the top spot.</p>
            )}

            <p className="note">
              {settings.topPerformerBonus
                ? `The top creator of the month gets a bonus of ${coins(settings.topPerformerBonus)}. The board resets on the 1st.`
                : 'The monthly board resets on the 1st.'}
            </p>
          </>
        )}
      </main>
    </Screen>
  );
}
