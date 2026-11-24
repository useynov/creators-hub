import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Level } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Progress, Screen, TopBar } from '../components/ui';
import { levelName } from '../format';
import { useHub } from '../hub';

const ORDER: Level[] = ['member', 'pro', 'partner'];
const GROWS = ['How much you publish', 'How many views you get', 'How much we like the work'];

/** Three levels. Member: tasks, events, merch. Pro: cash-out. Partner: paid offers. */
export function Levels() {
  const { me, settings } = useHub();
  const mine = ORDER.indexOf(me.level);

  const perks: Record<Level, ReactNode> = {
    member: 'Tasks for coins, all our events, the merch and gift shop, our news first.',
    pro: (
      <>
        Everything in Member, plus <strong>cash-out</strong>: turn your coins into money.
      </>
    ),
    partner: (
      <>
        Everything in Pro, plus <strong>paid offers</strong>: we pay you per publication.
      </>
    ),
  };

  return (
    <Screen>
      <TopBar back="/profile" backLabel="Back to profile" title="Levels" />
      <main className="body" style={{ gap: 24, paddingTop: 4 }}>
        <h1 className="display t-display">Your way up</h1>

        <div className="steps">
          {ORDER.map((level, index) => {
            const here = index === mine;
            return (
              <section key={level} className="step" data-state={here ? 'now' : index < mine ? 'done' : 'todo'} style={{ padding: '20px 0' }}>
                <span className="step__n" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="stack" style={{ flex: 1, gap: 8, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <h2 className="display" style={{ fontSize: 26 }}>
                      {levelName(level)}
                    </h2>
                    {here ? (
                      <span className="chip chip--red chip--sm">You are here</span>
                    ) : (
                      <span className="nums t-sm muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <Icon name={index < mine ? 'check' : 'lock'} size={16} stroke={2.2} />
                        <span>{index < mine ? 'Unlocked' : `Rating ${settings.levels[level as 'pro' | 'partner']}`}</span>
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 15, lineHeight: 1.5 }}>{perks[level]}</p>
                  {index === mine + 1 && (
                    <div className="stack" style={{ gap: 8, paddingTop: 4 }}>
                      <Progress value={me.progress} />
                      <div className="nums t-sm muted">You are at {me.rating}. Keep going.</div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <section className="section">
          <h2 className="eyebrow">What grows your rating</h2>
          <div className="grid3" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: 'var(--black)' }}>
            {GROWS.map((line) => (
              <div key={line} className="tile">
                {line}
              </div>
            ))}
          </div>
        </section>

        <div className="spacer" />
        <Link to="/tasks" className="btn">
          Find a task
        </Link>
      </main>
    </Screen>
  );
}
