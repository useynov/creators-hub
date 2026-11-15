import { useEffect, type CSSProperties, type ReactNode } from 'react';
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
  const [dayNumber, month] = date ? dayParts(date) : ['?', (monthHint ?? 'Soon').slice(0, 4)];
  return (
    <div className={`datebox${large ? ' datebox--lg' : ''}${white ? ' datebox--white' : ''}`}>
      <b>{dayNumber}</b>
      <span>{month}</span>
    </div>
  );
}

/** A photo slot. Shows the striped placeholder from the design until a photo is set. */
export function Cover({ src, alt, style }: { src: string | null; alt: string; style: CSSProperties }) {
  return (
    <div className="stripes" style={style} role={src ? undefined : 'img'} aria-label={src ? undefined : alt}>
      {src && <img src={src} alt={alt} loading="lazy" />}
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
