// Dates are shown in the hub's own time zone, whatever the phone is set to.
let timeZone = 'Asia/Almaty';
export function setTimeZone(zone: string): void {
  timeZone = zone;
}

/** A calendar date (YYYY-MM-DD) has no zone; a timestamp is shown in the hub's zone. */
function parse(value: string): { date: Date; zone: string } {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: new Date(`${value}T00:00:00Z`), zone: 'UTC' }
    : { date: new Date(value), zone: timeZone };
}

function format(value: string, options: Intl.DateTimeFormatOptions): string {
  const { date, zone } = parse(value);
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: zone }).format(date);
}

/** 25 Dec */
export const day = (value: string): string => format(value, { day: 'numeric', month: 'short' });
/** 25 December */
export const dayLong = (value: string): string => format(value, { day: 'numeric', month: 'long' });
/** 25 Dec, 23:59 */
export const dayTime = (value: string): string =>
  `${day(value)}, ${format(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
/** ["25", "DEC"] for the date badge */
export const dayParts = (value: string): [string, string] => [
  format(value, { day: 'numeric' }),
  format(value, { month: 'short' }).toUpperCase(),
];
/** December */
export const monthName = (date = new Date()): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone }).format(date);

export const num = (value: number): string => value.toLocaleString('en-US');
export const coins = (value: number): string => `${num(value)} ${Math.abs(value) === 1 ? 'coin' : 'coins'}`;
/** What an item costs, in words: "30 coins", or "Free". */
export const price = (value: number): string => (value === 0 ? 'Free' : coins(value));
export const signed = (value: number): string => (value > 0 ? `+${num(value)}` : num(value).replace('-', '−'));

export const levelName = (level: string): string => level.charAt(0).toUpperCase() + level.slice(1);
export const shortLink = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** 2.4K, 12K, 1.2M: a number of views in a line of small text. */
export function compact(value: number): string {
  if (value < 1000) return String(value);
  const [scaled, unit] = value < 1_000_000 ? [value / 1000, 'K'] : [value / 1_000_000, 'M'];
  return `${scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled)}${unit}`;
}

/** FRI, for the day column of "Coming up". */
export const weekdayShort = (value: string): string => format(value, { weekday: 'short' }).toUpperCase();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Today's date in the hub's time zone, YYYY-MM-DD. */
function today(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
  const get = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days from today to a calendar date; 0 is today, negative is the past. */
export function daysUntil(date: string, nowMs = Date.now()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today(nowMs)}T00:00:00Z`)) / DAY);
}

/**
 * How long a task still runs, as words and as the share of its time already gone (for the thin
 * bar). `openedAt` is when it opened; without it the bar covers the last 30 days.
 */
export function timeLeft(deadline: string, openedAt: string | null, nowMs = Date.now()): { text: string; share: number } {
  const end = Date.parse(deadline);
  const left = end - nowMs;
  const opened = openedAt ? Date.parse(openedAt) : NaN;
  const start = Number.isFinite(opened) && opened < end ? opened : end - 30 * DAY;
  const share = Math.max(0.04, Math.min(1, (nowMs - start) / (end - start)));
  if (left <= 0) return { text: 'Ended', share: 1 };
  if (left < HOUR) return { text: 'Less than an hour left', share };
  if (left < DAY) {
    const hours = Math.ceil(left / HOUR);
    return { text: `${hours} ${hours === 1 ? 'hour' : 'hours'} left`, share };
  }
  const days = Math.floor(left / DAY);
  return { text: `${days} ${days === 1 ? 'day' : 'days'} left`, share };
}

/** How long ago a story went up: "Just now", "2 h", "Yesterday", "3 d", then the date. */
export function ago(value: string, nowMs = Date.now()): string {
  const passed = nowMs - Date.parse(value);
  if (passed < HOUR) return 'Just now';
  if (passed < DAY) return `${Math.floor(passed / HOUR)} h`;
  if (passed < 2 * DAY) return 'Yesterday';
  if (passed < 7 * DAY) return `${Math.floor(passed / DAY)} d`;
  return day(value);
}
