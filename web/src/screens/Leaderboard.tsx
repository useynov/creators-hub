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
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="display" style={{ fontSize: 30 }}>
            Top creators
          </h1>
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
            <section className="panel panel--red" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 20, padding: 16 }}>
              <div className="nums" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>
                {data.me ? `#${data.me.rank}` : '–'}
              </div>
              <div className="stack" style={{ flex: 1, gap: 2 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Your place</div>
                <div className="nums" style={{ fontSize: 14, fontWeight: 500 }}>
                  {data.me ? `${num(data.me.views)} views ${scope}` : `No approved posts ${scope} yet`}
                </div>
              </div>
            </section>

            {data.top.length ? (
              <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: '4px 16px' }}>
                {data.top.map((row) => {
                  const first = row.rank === 1;
                  return (
                    <li key={row.rank} className="row" style={{ alignItems: 'center', padding: '12px 0', color: 'var(--ink)' }}>
                      <div className="nums" style={{ width: 28, fontSize: 18, fontWeight: 800, color: first ? 'var(--red-dark)' : 'var(--ink)' }}>
                        {row.rank}
                      </div>
                      <div
                        className="avatar"
                        style={{ width: 40, height: 40, fontSize: 14, fontWeight: 700, background: first ? 'var(--ink)' : 'var(--line)', color: first ? 'var(--white)' : 'var(--ink)' }}
                      >
                        {row.handle.replace(/^@/, '').charAt(0)}
                      </div>
                      <div className="stack" style={{ flex: 1, gap: 1, minWidth: 0, textAlign: 'left', fontWeight: 700 }}>
                        <div style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.handle}
                          {row.isMe ? ' (you)' : ''}
                        </div>
                        {first && period === 'month' && settings.topPerformerBonus ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--red-dark)' }}>
                            <Icon name="trophy" size={14} stroke={2.2} />
                            <span>Gets the top performer bonus</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="nums" style={{ fontSize: 15, fontWeight: 800 }}>
                        {num(row.views)}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="card empty">The board is empty so far. The first approved post takes the top spot.</div>
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
