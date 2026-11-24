import { Link, Navigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import type { EventsView, EventView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Cover, DateBox, Loading, Problem, Screen, TextBlocks, TopBar } from '../components/ui';
import { coins, dayLong } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';

const weekday = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/** One event on its own page: the photo, when and where, the programme, the linked task, and the RSVP. */
export function Event() {
  const { id = '' } = useParams();
  const { settings } = useHub();
  const toast = useToast();
  const { data, error, mutate } = useSWR<EventsView>('/api/events');

  const [come, busy] = useAction(async () => {
    await mutate(api.post<EventsView>(`/api/events/${id}/rsvp`), { revalidate: false });
    buzz('success');
    toast('You are on the list. Your pass is ready.');
  });
  const [cancel, cancelling] = useAction(async () => {
    await mutate(api.del<EventsView>(`/api/events/${id}/rsvp`), { revalidate: false });
    toast('Got it. You are off the list for this one.');
  });
  const [remind] = useAction(async () => {
    await mutate(api.post<EventsView>(`/api/events/${id}/remind`), { revalidate: false });
    toast('Done. The bot will message you when the details are out.');
  });

  if (!data) {
    return (
      <Screen>
        <TopBar back="/events" backLabel="Back to events" title="Event" />
        {error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />}
      </Screen>
    );
  }
  const past = data.past.some((candidate) => candidate.id === id);
  const event: EventView | undefined = [...data.upcoming, ...data.past].find((candidate) => candidate.id === id);
  if (!event) return <Navigate to="/events" replace />;

  const others = event.goingCount - (event.going ? 1 : 0);
  const coming =
    event.goingCount === 0
      ? null
      : event.going
        ? others > 0
          ? `You and ${others} more ${others === 1 ? 'creator' : 'creators'} are coming`
          : 'You are coming'
        : `${event.goingCount} ${event.goingCount === 1 ? 'creator is' : 'creators are'} coming`;

  return (
    <Screen>
      <TopBar back="/events" backLabel="Back to events" title="Event" />
      <main className="body" style={{ gap: 18 }}>
        {event.coverUrl && <Cover src={event.coverUrl} alt="" style={{ height: 210, borderRadius: 24 }} eager />}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <DateBox date={event.date} monthHint={event.monthHint} large />
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <h1 className="display" style={{ fontSize: 28, lineHeight: 1.1 }}>
              {event.title}
            </h1>
            {event.going && !past && (
              <span className="chip chip--red chip--sm" style={{ alignSelf: 'flex-start' }}>
                {event.checkedIn ? 'You are checked in' : 'You are on the list'}
              </span>
            )}
          </div>
        </div>

        <div className="facts">
          <div className="fact">
            <Icon name="calendar" size={20} />
            <div className="stack" style={{ gap: 2 }}>
              <b>{event.date ? `${weekday(event.date)}, ${dayLong(event.date)}` : event.monthHint ? `In ${event.monthHint}` : 'Date to be announced'}</b>
              {event.time && <span className="muted">Starts at {event.time}</span>}
            </div>
          </div>
          {event.place && (
            <div className="fact">
              <Icon name="pin" size={20} />
              <b>{event.place}</b>
            </div>
          )}
          {coming && !past && (
            <div className="fact">
              <Icon name="user" size={20} />
              <span>{coming}</span>
            </div>
          )}
          {settings.checkinCoins > 0 && !past && !event.checkedIn && (
            <div className="fact">
              <Icon name="gift" size={20} />
              <span>+{coins(settings.checkinCoins)} when your pass is scanned at the entrance</span>
            </div>
          )}
        </div>

        {event.description && <p className="lede">{event.description}</p>}

        {event.details && (
          <section className="card card--col brief__body" style={{ borderRadius: 24, padding: 18 }}>
            <TextBlocks text={event.details} />
          </section>
        )}

        {event.taskId && !past && (
          <Link to={`/tasks/${event.taskId}`} className="card card--row" style={{ gap: 12, borderRadius: 24, alignItems: 'center' }}>
            <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <div className="eyebrow">Task for this event</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{event.taskTitle ?? 'Open the task'}</div>
              {event.taskReward ? <div className="muted" style={{ fontSize: 14 }}>+{coins(event.taskReward)}</div> : null}
            </div>
            <Icon name="right" size={20} />
          </Link>
        )}

        <div className="spacer" />
        <div className="actions">
          {past ? (
            <p className="muted" style={{ textAlign: 'center', fontSize: 15 }}>
              {event.checkedIn ? 'You were there. Thank you for coming.' : 'This event has already happened.'}
            </p>
          ) : !event.date ? (
            <button type="button" className="btn" onClick={() => remind()} disabled={event.reminded}>
              {event.reminded ? 'Reminder set' : 'Remind me when the details are out'}
            </button>
          ) : event.going ? (
            <>
              <Link to={`/events/${event.id}/pass`} className="btn">
                {event.checkedIn ? 'Open my pass' : 'Show my pass'}
              </Link>
              {!event.checkedIn && (
                <button type="button" className="textlink" onClick={() => cancel()} disabled={cancelling}>
                  I can't come
                </button>
              )}
            </>
          ) : (
            <button type="button" className="btn" onClick={() => come()} disabled={busy}>
              I'm coming
            </button>
          )}
        </div>
      </main>
    </Screen>
  );
}
