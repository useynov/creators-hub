import { Link, Navigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import type { EventsView, EventView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, TextBlocks, TopBar } from '../components/ui';
import { coins, dayLong } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';
import { EventFace } from './Events';

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
      <EventFace event={event} square minHeight={340} top={<TopBar over back="/events" backLabel="Back to events" title="Event" />}>
        {event.going && !past && (
          <span className="chip chip--white" style={{ alignSelf: 'flex-start' }}>
            {event.checkedIn ? 'You are checked in' : 'You are on the list'}
          </span>
        )}
      </EventFace>
      <main className="body" style={{ gap: 24, paddingTop: 8 }}>
        <div className="facts" style={{ borderTop: 0 }}>
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
          <section className="brief__body" style={{ padding: 0 }}>
            <TextBlocks text={event.details} />
          </section>
        )}

        {event.taskId && !past && (
          <Link to={`/tasks/${event.taskId}`} className="card card--row" style={{ gap: 12 }}>
            <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <div className="t-sm muted">Task for this event</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--black)' }}>{event.taskTitle ?? 'Open the task'}</div>
            </div>
            {event.taskReward ? <span className="chip chip--pink nums">+{coins(event.taskReward)}</span> : null}
            <Icon name="right" size={20} color="var(--muted)" />
          </Link>
        )}

        <div className="dock actions">
          {past ? (
            <p className="muted t-sm">
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
