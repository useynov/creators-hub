import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { errorText } from '../api';
import { dayParts } from '../format';
import { setChrome } from '../telegram';
import { Icon, type IconName } from './Icon';

type Tone = 'light' | 'red' | 'dark';
const TONE_COLOR: Record<Tone, string> = { light: '#F6F2EF', red: '#DC0A17', dark: '#1C1414' };

interface ScreenProps {
  /** Background of the whole screen. */
  tone?: Tone;
  /** Colour at the very top, so Telegram's header blends in. Defaults to the tone. */
  top?: Tone;
  children: ReactNode;
}

export function Screen({ tone = 'light', top = tone, children }: ScreenProps) {
  useEffect(() => {
    document.body.dataset.tone = tone;
    setChrome(TONE_COLOR[top]);
    window.scrollTo(0, 0);
  }, [tone, top]);
  return <div className={`screen${tone === 'light' ? '' : ` screen--${tone}`}`}>{children}</div>;
}

interface TopBarProps {
  back: string;
  backLabel: string;
  title: ReactNode;
  light?: boolean;
  right?: ReactNode;
  /** Render the title as the page heading (h1). */
  heading?: boolean;
}

export function TopBar({ back, backLabel, title, light, right, heading }: TopBarProps) {
  return (
    <header className={`topbar${light ? ' topbar--light' : ''}`}>
      <Link to={back} aria-label={backLabel} className="topbar__back">
        <Icon name="back" />
      </Link>
      {heading ? (
        <h1 className="topbar__title" style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
          {title}
        </h1>
      ) : (
        <div className="topbar__title">{title}</div>
      )}
      {right}
    </header>
  );
}

const TABS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/tasks', label: 'Tasks', icon: 'tasks' },
  { to: '/wallet', label: 'Rewards', icon: 'gift' },
  { to: '/events', label: 'Events', icon: 'calendar' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

/** `active` overrides the route match, for screens that live under another tab. */
export function TabBar({ active }: { active?: string }) {
  const { pathname } = useLocation();
  const current = active ?? pathname;
  return (
    <nav aria-label="Main" className="tabbar">
      {TABS.map((tab) => (
        <Link key={tab.to} to={tab.to} aria-current={current === tab.to ? 'page' : undefined}>
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function Progress({ value, large }: { value: number; large?: boolean }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={`progress${large ? ' progress--lg' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Progress to the next level"
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

interface DateBoxProps {
  date: string | null;
  monthHint?: string | null;
  large?: boolean;
  white?: boolean;
}

export function DateBox({ date, monthHint, large, white }: DateBoxProps) {
  const cls = `datebox${large ? ' datebox--lg' : ''}${white ? ' datebox--white' : ''}`;
  if (!date) {
    // No day yet: the month if we know it, otherwise a calendar, never a question mark.
    return (
      <div className={cls}>
        {monthHint ? <b style={{ fontSize: 14 }}>{monthHint.slice(0, 4).toUpperCase()}</b> : <Icon name="calendar" size={large ? 24 : 20} />}
      </div>
    );
  }
  const [dayNumber, month] = dayParts(date);
  return (
    <div className={cls}>
      <b>{dayNumber}</b>
      <span>{month}</span>
    </div>
  );
}

interface CoverProps {
  src: string | null;
  alt: string;
  /** The box is sized before the picture arrives, so nothing jumps while it loads: a height is required. */
  style: CSSProperties & { height: number };
  /** Above the fold (the first thing on a screen): load at once instead of lazily. */
  eager?: boolean;
}

/**
 * A photo in a box of fixed height that it fills (object-fit: cover). With no address, or when
 * the picture does not load, a calm warm block takes its place: never a broken image, never text.
 */
export function Cover({ src, alt, style, eager }: CoverProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <div className={`photo${show ? '' : ' photo--empty'}`} style={style}>
      {show ? (
        <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(src)} />
      ) : (
        <Icon name="image" size={28} stroke={1.6} />
      )}
    </div>
  );
}

/** The creator's Instagram picture, or their initial when we have none. */
export function Avatar({ src, name, size, light }: { src: string | null; name: string; size: number; light?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: light ? 'var(--white)' : 'var(--pink)',
        color: 'var(--red-dark)',
        overflow: 'hidden',
      }}
    >
      {show ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setFailed(src)}
        />
      ) : (
        <span aria-hidden="true">{name.charAt(0) || '·'}</span>
      )}
    </div>
  );
}

/**
 * A brief written as plain text: paragraphs split by a blank line. A paragraph whose first line
 * is short and has no full stop is a heading over the lines below it.
 */
function briefBlocks(text: string): Array<{ heading: string | null; lines: string[] }> {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length)
    .map((lines) => {
      const first = lines[0]!;
      const isHeading = lines.length > 1 && first.length <= 40 && !/[.!?:]$/.test(first);
      return isHeading ? { heading: first, lines: lines.slice(1) } : { heading: null, lines };
    });
}

/** The collapsible "Detailed brief". Closed by default: the screen leads with the photo and the steps. */
export function Brief({ text, dark }: { text: string; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`brief${dark ? ' brief--dark' : ''}`}>
      <button type="button" className="brief__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <Icon name="doc" size={20} />
        <span>Detailed brief</span>
        <span className="brief__chevron" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
          <Icon name="right" size={18} />
        </span>
      </button>
      {open && (
        <div id={id} className="brief__body">
          <TextBlocks text={text} />
        </div>
      )}
    </section>
  );
}

/** Plain text shown as headed blocks and lists (see briefBlocks). Used by the brief and the event page. */
export function TextBlocks({ text }: { text: string }) {
  return (
    <>
      {briefBlocks(text).map((block, index) => (
        <div key={index} className="stack" style={{ gap: 4 }}>
          {block.heading && <h3 className="brief__heading">{block.heading}</h3>}
          {block.lines.length > 1 && block.heading ? (
            <ul>
              {block.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            block.lines.map((line) => <p key={line}>{line}</p>)
          )}
        </div>
      ))}
    </>
  );
}

/** Where the creator's account stands with the team: a quiet note while pending, a lock when rejected. */
export function AccountNote({ status, note, confirmTime }: { status: string; note: string | null; confirmTime: string | null }) {
  if (status === 'confirmed') return null;
  if (status === 'rejected') {
    return (
      <div className="hint hint--red" role="status">
        <Icon name="lock" size={22} />
        <div className="stack" style={{ gap: 4 }}>
          <strong>Tasks are locked: we could not confirm your account.</strong>
          {note && <span>{note}</span>}
          <Link to="/profile/instagram" style={{ fontWeight: 700 }}>
            Connect the account that is yours
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="hint hint--soft" role="status">
      <Icon name="clock" size={20} />
      <div>
        <strong>Your account is being confirmed</strong>
        {confirmTime ? `, usually within ${confirmTime}` : ''}. You can take tasks now: coins arrive once it is confirmed.
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="center" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}

export function Problem({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="center">
      <p className="lede">{errorText(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
