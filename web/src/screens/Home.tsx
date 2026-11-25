import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { EventsView, EventView, HomeView, HubStoryView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { TaskCard } from '../components/TaskCard';
import { AccountNote, HubHeader, Loading, Problem, ProfileRing, Screen, TabBar, keepBrand } from '../components/ui';
import { dayParts, levelName, weekdayShort } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';

const NEXT_PERK = { pro: 'cash-out opens', partner: 'paid offers open' };

/**
 * Landing screen. The creator's photo in the ring of their progress, the Hub's stories, the tasks
 * they can join today, and the next events. Their own work in progress lives in the Tasks tab;
 * Home only says when the team has sent something back.
 */
export function Home() {
  const { me, settings } = useHub();
  const { data, error, mutate } = useSWR<HomeView>('/api/home');
  const { mutate: refresh } = useSWRConfig();
  const toast = useToast();

  const [comeTo, answering] = useAction(async (eventId: string) => {
    const events = await api.post<EventsView>(`/api/events/${eventId}/rsvp`);
    await refresh('/api/events', events, { revalidate: false });
    await mutate();
    buzz('success');
    toast('You are on the list. Your pass is on the event page.');
  });

  const toNext = me.nextLevel && me.nextThreshold ? Math.max(0, me.nextThreshold - me.rating) : null;
  const ringLabel = me.nextThreshold ? `Rating ${me.rating} of ${me.nextThreshold}, progress to ${levelName(me.nextLevel!)}` : `Rating ${me.rating}, top level`;

  return (
    <Screen>
      <HubHeader brandName={settings.brandName} balance={me.balance} />

      <main className="body body--tabs" style={{ paddingTop: 22, gap: 0 }}>
        <Link to="/profile" className="hello" aria-label={`Hi, ${me.firstName}. Open your profile`}>
          <ProfileRing src={me.avatarUrl} name={me.firstName} progress={me.progress} badge={me.nextThreshold ? `${me.rating} / ${me.nextThreshold}` : String(me.rating)} label={ringLabel} />
          <span className="hello__text">
            <h1 className="display">Hi, {me.firstName}</h1>
            <span className="nums" style={{ fontSize: 15 }}>
              <strong style={{ color: 'var(--black)' }}>{levelName(me.level)}</strong>
              {me.rank ? ` · #${me.rank} this month` : ''}
            </span>
            <span className="t-sm muted nums">
              {toNext !== null && me.nextLevel
                ? `${toNext} ${toNext === 1 ? 'point' : 'points'} to ${levelName(me.nextLevel)}, where ${NEXT_PERK[me.nextLevel]}.`
                : 'Top level: paid offers are open for you.'}
            </span>
          </span>
        </Link>

        {!data ? (
          <div style={{ paddingTop: 24 }}>{error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />}</div>
        ) : (
          <>
            {data.stories.length > 0 && <Stories stories={data.stories} />}

            <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
              <AccountNote status={me.accountStatus} note={me.accountNote} confirmTime={settings.accountConfirmTime} />

              {data.offer && (
                <Link to="/offer" className="card card--row card--dark" style={{ gap: 12, padding: '16px 20px' }}>
                  <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                    <div className="t-sm muted">Paid offer, only for you</div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{keepBrand(data.offer.campaign)}</div>
                  </div>
                  <Icon name="right" size={20} />
                </Link>
              )}

              {data.needsFix.count > 0 && (
                <Link to={data.needsFix.count === 1 && data.needsFix.taskId ? `/tasks/${data.needsFix.taskId}` : '/tasks?tab=mine'} className="fixline">
                  <Icon name="alert" size={20} />
                  <span>{data.needsFix.count === 1 ? '1 task needs a fix' : `${data.needsFix.count} tasks need a fix`}</span>
                  <Icon name="right" size={18} />
                </Link>
              )}
            </div>

            <section className="section" style={{ paddingTop: 16 }}>
              <div className="section__head">
                <h2 className="eyebrow eyebrow--lg">Open tasks</h2>
                <Link to="/tasks?tab=open">All tasks{data.openCount > data.openTasks.length ? ` (${data.openCount})` : ''}</Link>
              </div>
              {data.openTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
              {!data.openTasks.length && (
                <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
                  No open tasks right now.{' '}
                  {data.soonCount > 0 ? (
                    <Link to="/tasks?tab=soon" style={{ color: 'var(--black)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                      {data.soonCount === 1 ? '1 opens soon' : `${data.soonCount} open soon`}
                    </Link>
                  ) : (
                    'The bot will message you when one opens.'
                  )}
                </p>
              )}
            </section>

            {data.events.length > 0 && (
              <section className="section" style={{ paddingTop: 20 }}>
                <div className="section__head">
                  <h2 className="eyebrow eyebrow--lg">Coming up</h2>
                  <Link to="/events">All events</Link>
                </div>
                <div className="upnext">
                  {data.events.map((event) => (
                    <ComingUp key={event.id} event={event} busy={answering} onCome={() => comeTo(event.id)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}

/** The Hub's stories as a row of circles: a red ring until the creator has opened one. */
function Stories({ stories }: { stories: HubStoryView[] }) {
  return (
    <nav aria-label="Hub stories" className="stories bleed">
      {stories.map((story) => (
        <Link key={story.id} to={`/hub/${story.id}`} className={`storydot${story.seen ? ' storydot--seen' : ''}`} aria-label={`${story.label}: ${story.headline}${story.seen ? ', seen' : ', new'}`}>
          <span className="storydot__ring">
            <span className={`storydot__face storydot__face--${story.tone}`}>
              {story.imageUrl ? <img src={story.imageUrl} alt="" loading="eager" decoding="async" /> : <b aria-hidden="true">{story.label.charAt(0)}</b>}
            </span>
          </span>
          <span className="storydot__label">{story.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** One coming event: the day set big on the left, then what and where, and "I'm in" until the creator is on the list. */
function ComingUp({ event, busy, onCome }: { event: EventView; busy: boolean; onCome: () => void }) {
  const [dayNumber] = dayParts(event.date!);
  const facts = [event.time, event.place, event.going ? (event.checkedIn ? 'you were there' : 'you are on the list') : null].filter(Boolean).join(' · ');
  return (
    <div className="upnext__row">
      <Link to={`/events/${event.id}`} className="upnext__link">
        <span className="upnext__day nums">
          <b>{dayNumber}</b>
          <span>{weekdayShort(event.date!)}</span>
        </span>
        <span className="upnext__what">
          <b>{event.title}</b>
          {facts && <span>{facts}</span>}
        </span>
      </Link>
      {!event.going && (
        <button type="button" className="btn btn--line" disabled={busy} onClick={onCome} aria-label={`I'm in for ${event.title}`}>
          I'm in
        </button>
      )}
    </div>
  );
}
