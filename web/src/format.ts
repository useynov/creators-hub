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
export const signed = (value: number): string => (value > 0 ? `+${num(value)}` : num(value).replace('-', '−'));

export const levelName = (level: string): string => level.charAt(0).toUpperCase() + level.slice(1);
export const shortLink = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
