import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { EventsView, EventView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { Cover, DateBox, Loading, Problem, Screen, TabBar } from '../components/ui';
import { dayLong, dayParts } from '../format';

const where = (event: EventView): string => [event.place, event.time].filter(Boolean).join(' · ');
const weekday = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/**
 * The face of an event: the day of the month, set big, then the name. With a photo it sits on the
 * photo; without one it is a flat red block. Used by the list (as a card) and the event page (edge to edge).
 */
export function EventFace({ event, square, top, minHeight, children }: { event: EventView; square?: boolean; top?: ReactNode; minHeight: number; children?: ReactNode }) {
  const photo = Boolean(event.coverUrl);
  const [dayNumber, month] = event.date ? dayParts(event.date) : [null, null];
  return (
    <div className={`lead${photo ? '' : ' lead--red on-red'}${square ? ' lead--square' : ''}`} style={{ minHeight }}>
      {photo && <Cover src={event.coverUrl} alt="" fill eager />}
      {top}
      <div className="lead__body" style={{ gap: 14 }}>
        {dayNumber ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <span className="index" style={{ fontSize: 96 }}>
              {dayNumber}
            </span>
            <span className="stack" style={{ gap: 2, paddingBottom: 8, fontSize: 15, lineHeight: 1.2 }}>
              <b>{month}</b>
              <span>{weekday(event.date!)}</span>
            </span>
          </div>
        ) : (
          <span className="index" style={{ fontSize: 44 }}>
            {event.monthHint ?? 'Soon'}
          </span>
        )}
        {square ? <h1 className="lead__title">{event.title}</h1> : <h2 className="lead__title">{event.title}</h2>}
        {children}
      </div>
    </div>
  );
}

/** The list of events. Tapping one opens its own page, with the details and the RSVP. */
export function Events() {
  const { data, error, mutate } = useSWR<EventsView>('/api/events');
  const [showPast, setShowPast] = useState(false);

  const dated = data?.upcoming.filter((event) => event.date) ?? [];
  const soon = data?.upcoming.filter((event) => !event.date) ?? [];
  const [featured, ...later] = dated;
  const rest = [...later, ...soon];

  return (
    <Screen>
      <main className="body body--tabs" style={{ paddingTop: 28, gap: 20 }}>
        <div className="stack" style={{ gap: 10 }}>
          <h1 className="display t-display">Events</h1>
          <p className="muted" style={{ fontSize: 15, maxWidth: '34ch' }}>
            As a member you are welcome at all of them.
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
              <Link to={`/events/${featured.id}`} style={{ color: 'inherit' }}>
                <EventFace event={featured} minHeight={300}>
                  {where(featured) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 500 }}>
                      <Icon name="pin" size={18} />
                      <span>{where(featured)}</span>
                    </div>
                  )}
                  <div className="lead__foot">
                    <span className="btn btn--sm btn--white">See details</span>
                    {featured.going && <span className="chip glass">{featured.checkedIn ? 'You were there' : 'You are on the list'}</span>}
                  </div>
                </EventFace>
              </Link>
            )}

            {rest.length > 0 && (
              <section className="section">
                <h2 className="eyebrow">Later</h2>
                <div className="menu">
                  {rest.map((event) => (
                    <Link key={event.id} to={`/events/${event.id}`}>
                      <DateBox date={event.date} monthHint={event.monthHint} />
                      <span className="menu__label">
                        {event.title}
                        <small>
                          {event.going
                            ? 'You are on the list'
                            : event.date
                              ? where(event) || dayLong(event.date)
                              : [event.place, event.reminded ? 'reminder set' : 'details soon'].filter(Boolean).join(' · ')}
                        </small>
                      </span>
                      <Icon name="right" size={20} color="var(--muted)" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {!data.upcoming.length && <p className="empty">No events on the calendar yet. The bot will tell you first.</p>}

            {data.past.length > 0 && (
              <section className="brief">
                <button type="button" className="brief__toggle" aria-expanded={showPast} onClick={() => setShowPast((open) => !open)}>
                  <Icon name="clock" size={20} />
                  <span>Past events</span>
                  <span className="brief__chevron" style={{ transform: showPast ? 'rotate(90deg)' : undefined }}>
                    <Icon name="right" size={18} />
                  </span>
                </button>
                {showPast && (
                  <div className="menu" style={{ marginBottom: -1 }}>
                    {data.past.map((event) => (
                      <Link key={event.id} to={`/events/${event.id}`}>
                        <DateBox date={event.date} />
                        <span className="menu__label">
                          {event.title}
                          <small>{event.checkedIn ? 'You were there' : (event.place ?? dayLong(event.date!))}</small>
                        </span>
                        <Icon name="right" size={20} color="var(--muted)" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}
