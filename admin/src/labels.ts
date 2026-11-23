// Turning API values into words: the audience of a task, the formats, follower ranges.

import type { AudienceInput, PublicationKind } from '../../server/src/admin/types';
import type { Dict, Format } from './i18n';

/** "1 до 3 тыс." / "1k to 3k" style for follower counts. */
export function shortCount(n: number, lang: 'ru' | 'en'): string {
  if (n >= 1000) {
    const k = Math.round((n / 1000) * 10) / 10;
    const text = String(k).replace('.', lang === 'ru' ? ',' : '.');
    return lang === 'ru' ? `${text} тыс.` : `${text}k`;
  }
  return String(n);
}

export function followersRange(t: Dict, lang: 'ru' | 'en', min: number | null | undefined, max: number | null | undefined): string | null {
  const a = min ?? null;
  const b = max ?? null;
  if (a === null && b === null) return null;
  if (a !== null && b !== null) {
    // "1 до 3 тыс.": the unit once, at the end, as people say it.
    if (lang === 'ru' && a >= 1000 && b >= 1000) return t.audience.between(shortCount(a, lang).replace(' тыс.', ''), shortCount(b, lang));
    return t.audience.between(shortCount(a, lang), shortCount(b, lang));
  }
  return a !== null ? t.audience.from(shortCount(a, lang)) : t.audience.upTo(shortCount(b!, lang));
}

export function audienceText(t: Dict, lang: 'ru' | 'en', audience: AudienceInput): string {
  if (audience.mode === 'all') return t.audience.all;
  if (audience.mode === 'list') return t.audience.list(audience.userIds?.length ?? 0);
  const parts: string[] = [];
  if (audience.cities?.length) parts.push(t.audience.city(audience.cities.map((city) => t.city(city)).join(', ')));
  const range = followersRange(t, lang, audience.followersMin, audience.followersMax);
  if (range) parts.push(t.audience.followers(range));
  if (audience.levels?.length) parts.push(t.audience.levels(audience.levels.map((level) => t.levels[level]).join(', ')));
  if (audience.tags?.length) parts.push(audience.tags.length === 1 ? t.audience.tagOne(audience.tags[0]!) : t.audience.tags(audience.tags.join(', ')));
  return parts.length ? parts.join(', ') : t.audience.all;
}

export function formatsText(t: Dict, formats: PublicationKind[]): string {
  if (!formats.length) return t.tasks.anyFormat;
  return formats.map((kind) => t.kinds[kind]).join(', ');
}

/** Formats and place, the grey line under a task's title. */
export function taskMeta(t: Dict, formats: PublicationKind[], place: string | null): string {
  return [formatsText(t, formats), place].filter(Boolean).join('. ');
}

export const kindsSummary = (t: Dict, f: Format, byKind: Partial<Record<PublicationKind, number>>): string =>
  (Object.entries(byKind) as Array<[PublicationKind, number]>)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${t.kindsPlural[kind]} ${f.num(n)}`)
    .join(', ');
