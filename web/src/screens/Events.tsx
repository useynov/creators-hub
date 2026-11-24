import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { EventsView, EventView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Cover, DateBox, Loading, Problem, Screen, TabBar } from '../components/ui';
import { dayLong } from '../format';

const where = (event: EventView): string => [event.place, event.time].filter(Boolean).join(' · ');

/** The list of events. Tapping one opens its own page, with the details and the RSVP. */
export function Events() {
  const { data, error, mutate } = useSWR<EventsView>('/api/events');
  const [showPast, setShowPast] = useState(false);

  const dated = data?.upcoming.filter((event) => event.date) ?? [];
  const soon = data?.upcoming.filter((event) => !event.date) ?? [];
  const [featured, ...later] = dated;

  /** Where the creator stands with an event, said in a few words on its card. */
  const status = (event: EventView, light?: boolean) =>
    event.going ? (
      <span className={`chip chip--sm ${light ? 'chip--white' : 'chip--red'}`} style={{ alignSelf: 'flex-start' }}>{event.checkedIn ? 'You were there' : 'You are on the list'}</span>
    ) : null;

  return (
    <Screen>
      <main className="body body--tabs" style={{ paddingTop: 28 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="display" style={{ fontSize: 32 }}>
            Events
          </h1>
          <p className="muted" style={{ fontSize: 15 }}>
            As a member you are welcome at all of them. Tap an event to see the details.
          </p>
        </div>

        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            {featured && (
              <Link
                to={`/events/${featured.id}`}
                className="panel panel--red"
                style={{ padding: featured.coverUrl ? 10 : 20, gap: 16, paddingBottom: 20, textDecoration: 'none' }}
              >
                {featured.coverUrl && <Cover src={featured.coverUrl} alt="" style={{ height: 170, borderRadius: 16 }} eager />}
                <div className="stack" style={{ gap: 14, padding: featured.coverUrl ? '0 10px' : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <DateBox date={featured.date} large white />
                    <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                      <h2 className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>
                        {featured.title}
                      </h2>
                      {where(featured) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 600 }}>
                          <Icon name="pin" size={18} />
                          <span>{where(featured)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {featured.description && <p className="lede">{featured.description}</p>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    {status(featured, true) ?? <span />}
                    <span className="btn btn--sm btn--white" style={{ pointerEvents: 'none' }}>
                      See details
                    </span>
                  </div>
                </div>
              </Link>
            )}

            {later.map((event) => (
              <Link
                key={event.id}
                to={`/events/${event.id}`}
                className="card card--col"
                style={{ gap: 12, borderRadius: 24, padding: event.coverUrl ? 10 : 16, textDecoration: 'none', color: 'inherit' }}
              >
                {event.coverUrl && <Cover src={event.coverUrl} alt="" style={{ height: 140, borderRadius: 16 }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: event.coverUrl ? '0 6px 6px' : 0 }}>
                  <DateBox date={event.date} large />
                  <div className="stack" style={{ flex: 1, gap: 4, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{event.title}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {where(event) || dayLong(event.date!)}
                    </div>
                    {status(event)}
                  </div>
                  <Icon name="right" size={20} />
                </div>
              </Link>
            ))}

            {soon.map((event) => (
              <Link
                key={event.id}
                to={`/events/${event.id}`}
                className="card card--row"
                style={{ gap: 14, borderRadius: 24, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
              >
                <DateBox date={null} monthHint={event.monthHint} large />
                <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{event.title}</div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {[event.place, event.reminded ? 'reminder set' : 'details soon'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Icon name="right" size={20} />
              </Link>
            ))}

            {!data.upcoming.length && <div className="empty">No events on the calendar yet. The bot will tell you first.</div>}

            {data.past.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn--md"
                  aria-expanded={showPast}
                  style={{ justifyContent: 'space-between', padding: '0 16px', borderRadius: 18, background: 'var(--line)', color: 'var(--ink)', fontSize: 15 }}
                  onClick={() => setShowPast((open) => !open)}
                >
                  <span>Past events</span>
                  <span style={{ display: 'flex', transform: showPast ? 'rotate(90deg)' : undefined }}>
                    <Icon name="right" size={20} />
                  </span>
                </button>
                {showPast &&
                  data.past.map((event) => (
                    <Link
                      key={event.id}
                      to={`/events/${event.id}`}
                      className="card card--row"
                      style={{ gap: 14, padding: '12px 14px', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
                    >
                      <DateBox date={event.date} />
                      <div className="stack" style={{ flex: 1, gap: 2 }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{event.title}</div>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {event.checkedIn ? 'You were there' : (event.place ?? dayLong(event.date!))}
                        </div>
                      </div>
                      <Icon name="right" size={20} />
                    </Link>
                  ))}
              </>
            )}
          </>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}
