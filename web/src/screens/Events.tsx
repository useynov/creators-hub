import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { EventsView, EventView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Cover, DateBox, Loading, Problem, Screen, TabBar } from '../components/ui';
import { coins, dayLong } from '../format';
import { useAction, useToast } from '../hub';
import { buzz } from '../telegram';

const where = (event: EventView): string => [event.place, event.time].filter(Boolean).join(' · ');

/** Upcoming events. All members have access. One tap to say "I'm coming". */
export function Events() {
  const { data, error, mutate } = useSWR<EventsView>('/api/events');
  const toast = useToast();
  const [showPast, setShowPast] = useState(false);

  const [come, busy] = useAction(async (event: EventView) => {
    await mutate(api.post<EventsView>(`/api/events/${event.id}/rsvp`), { revalidate: false });
    buzz('success');
    toast('You are on the list. Your pass is ready.');
  });
  const [remind] = useAction(async (event: EventView) => {
    await mutate(api.post<EventsView>(`/api/events/${event.id}/remind`), { revalidate: false });
    toast('Done. The bot will message you when the details are out.');
  });

  const dated = data?.upcoming.filter((event) => event.date) ?? [];
  const soon = data?.upcoming.filter((event) => !event.date) ?? [];
  const [featured, ...later] = dated;

  const rsvpButton = (event: EventView, className: string) =>
    event.going ? (
      <Link to={`/events/${event.id}/pass`} className={className}>
        {event.checkedIn ? 'You were there' : 'Show my pass'}
      </Link>
    ) : (
      <button type="button" className={className} onClick={() => come(event)} disabled={busy}>
        I'm coming
      </button>
    );

  return (
    <Screen>
      <main className="body body--tabs" style={{ paddingTop: 28 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="display" style={{ fontSize: 32 }}>
            Events
          </h1>
          <p className="muted" style={{ fontSize: 15 }}>
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
              <section className="panel panel--red" style={{ padding: featured.coverUrl ? 10 : 20, gap: 16, paddingBottom: 20 }}>
                {featured.coverUrl && <Cover src={featured.coverUrl} alt="" style={{ height: 170, borderRadius: 16 }} eager />}
                <div className="stack" style={{ gap: 16, padding: featured.coverUrl ? '0 10px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <DateBox date={featured.date} large white />
                  <div className="stack" style={{ gap: 4 }}>
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
                {(featured.description || featured.taskReward) && (
                  <p className="lede">
                    {featured.description}
                    {featured.taskReward ? ` There is a task for this event too: +${coins(featured.taskReward)}.` : ''}
                  </p>
                )}
                {rsvpButton(featured, 'btn btn--md btn--white')}
                </div>
              </section>
            )}

            {later.map((event) => (
              <div key={event.id} className="card card--col" style={{ gap: 12, borderRadius: 24, padding: event.coverUrl ? 10 : 16 }}>
                {event.coverUrl && <Cover src={event.coverUrl} alt="" style={{ height: 140, borderRadius: 16 }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: event.coverUrl ? '0 6px' : 0 }}>
                  <DateBox date={event.date} large />
                  <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{event.title}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {where(event) || dayLong(event.date!)}
                    </div>
                  </div>
                </div>
                <div style={{ padding: event.coverUrl ? '0 6px 6px' : 0, display: 'flex' }}>{rsvpButton(event, 'btn btn--line btn--wide')}</div>
              </div>
            ))}

            {soon.map((event) => (
              <div key={event.id} className="card card--row" style={{ gap: 14, borderRadius: 24 }}>
                <DateBox date={null} monthHint={event.monthHint} large />
                <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{event.title}</div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {[event.place, 'details soon'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button type="button" className="btn btn--line" onClick={() => remind(event)} disabled={event.reminded}>
                  {event.reminded ? 'Reminder set' : 'Remind me'}
                </button>
              </div>
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
                    <div key={event.id} className="card card--row" style={{ gap: 14, padding: '12px 14px' }}>
                      <DateBox date={event.date} />
                      <div className="stack" style={{ flex: 1, gap: 2 }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{event.title}</div>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {event.checkedIn ? 'You were there' : (event.place ?? dayLong(event.date!))}
                        </div>
                      </div>
                    </div>
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
