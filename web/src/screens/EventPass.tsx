import QRCode from 'qrcode';
import { useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import type { EventsView, EventView } from '../../../server/src/types';
import { api } from '../api';
import { Loading, Problem, Screen, TopBar } from '../components/ui';
import { coins, dayLong, levelName } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { openExternal } from '../telegram';

/** The pass is a QR code the team scans with a phone camera: it opens the bot and checks the creator in. */
function Qr({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  }, [value]);
  return (
    <svg role="img" aria-label="Your pass: QR code" viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" shapeRendering="crispEdges">
      <path d={path} fill="#1C1414" />
    </svg>
  );
}

function calendarLink(event: EventView): string {
  const date = event.date!.replace(/-/g, '');
  const next = new Date(`${event.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${date}/${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
    location: event.place ?? '',
    details: event.time ? `Starts at ${event.time}` : '',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** RSVP gives a QR pass. Scanning it at the entrance confirms attendance. */
export function EventPass() {
  const { id = '' } = useParams();
  const { me, settings } = useHub();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, mutate } = useSWR<EventsView>('/api/events');
  const event = data && [...data.upcoming, ...data.past].find((candidate) => candidate.id === id);

  const [cancel, cancelling] = useAction(async () => {
    await mutate(api.del<EventsView>(`/api/events/${id}/rsvp`), { revalidate: false });
    toast('Got it. You are off the list for this one.');
    navigate(`/events/${id}`, { replace: true });
  });

  if (!data) {
    return (
      <Screen tone="red">
        <TopBar back={`/events/${id}`} backLabel="Back to the event" title="Your pass" light />
        {error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />}
      </Screen>
    );
  }
  if (!event?.going || !event.code) return <Navigate to="/events" replace />;

  const payload = settings.botUsername
    ? `https://t.me/${settings.botUsername}?start=checkin_${event.code}`
    : `checkin_${event.code}`;
  const handle = me.instagram ? `@${me.instagram}` : me.username ? `@${me.username}` : '';

  return (
    <Screen tone="red">
      <TopBar back={`/events/${id}`} backLabel="Back to the event" title="Your pass" light />
      <main className="body" style={{ gap: 16 }}>
        <section className="card card--col" style={{ borderRadius: 28, padding: '24px 20px', alignItems: 'center', gap: 18, textAlign: 'center' }}>
          <div className="stack" style={{ gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--red-dark)' }}>
              {event.checkedIn ? 'You are checked in' : 'You are on the list'}
            </div>
            <h1 className="display" style={{ fontSize: 28 }}>
              {event.title}
            </h1>
            <div className="muted" style={{ fontSize: 15 }}>
              {[dayLong(event.date!), event.place, event.time].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ width: 220, height: 220, borderRadius: 20, border: '3px solid var(--ink)', padding: 14, background: 'var(--white)' }}>
            <Qr value={payload} />
          </div>
          <div style={{ width: '100%', borderTop: '2px dashed var(--border)' }} />
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', gap: 12 }}>
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{me.firstName}</div>
              {handle && (
                <div className="muted" style={{ fontSize: 14 }}>
                  {handle}
                </div>
              )}
            </div>
            <span className="chip chip--ink">{levelName(me.level)}</span>
          </div>
        </section>

        <p style={{ color: 'var(--white)', fontSize: 15, lineHeight: 1.45, textAlign: 'center', fontWeight: 500 }}>
          Show this code at the entrance.
          {settings.checkinCoins > 0 && !event.checkedIn ? ` +${coins(settings.checkinCoins)} when it is scanned.` : ''}
        </p>

        <div className="spacer" />
        <div className="actions">
          <button type="button" className="btn btn--white" onClick={() => openExternal(calendarLink(event))}>
            Add to calendar
          </button>
          {event.checkedIn ? (
            <Link to={`/events/${id}`} className="textlink textlink--light">
              Back to the event
            </Link>
          ) : (
            <button type="button" className="textlink textlink--light" onClick={() => cancel()} disabled={cancelling}>
              I can't come
            </button>
          )}
        </div>
      </main>
    </Screen>
  );
}
