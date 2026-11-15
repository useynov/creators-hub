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
      <main className="body" style={{ gap: 10, paddingTop: 4 }}>
        <h1 className="display" style={{ fontSize: 28, marginBottom: 2 }}>
          Your way up
        </h1>

        {ORDER.map((level, index) => {
          const here = index === mine;
          const tone = here ? 'panel--red' : level === 'partner' ? 'panel--dark' : '';
          const onColor = here || level === 'partner';
          return (
            <section
              key={level}
              className={`panel ${tone}`}
              style={{ borderRadius: 22, padding: 18, gap: 10, background: tone ? undefined : 'var(--white)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h2 className="display" style={{ fontSize: 24 }}>
                  {levelName(level)}
                </h2>
                {here ? (
                  <span className="chip chip--sm" style={{ background: 'var(--white)', color: 'var(--red-dark)', fontWeight: 800 }}>
                    You are here
                  </span>
                ) : (
                  <span
                    className="nums"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: onColor ? undefined : 'var(--ink-2)' }}
                  >
                    <Icon name={index < mine ? 'check' : 'lock'} size={16} stroke={2.2} />
                    <span>{index < mine ? 'Unlocked' : `Rating ${settings.levels[level as 'pro' | 'partner']}`}</span>
                  </span>
                )}
              </div>
              <p className="lede" style={{ lineHeight: 1.45, fontWeight: here ? 500 : 400 }}>
                {perks[level]}
              </p>
              {index === mine + 1 && (
                <>
                  <Progress value={me.progress} />
                  <div className="nums" style={{ fontSize: 13, color: onColor ? undefined : 'var(--muted)' }}>
                    You are at {me.rating}. Keep going.
                  </div>
                </>
              )}
            </section>
          );
        })}

        <div className="card card--col" style={{ borderRadius: 22, padding: '16px 18px', gap: 10 }}>
          <h2 className="eyebrow">What grows your rating</h2>
          <div className="grid3" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
            {GROWS.map((line) => (
              <div key={line} className="tile" style={{ padding: '12px 10px' }}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className="spacer" />
        <Link to="/tasks" className="btn">
          Find a task
        </Link>
      </main>
    </Screen>
  );
}
