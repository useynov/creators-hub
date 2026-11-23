// Who sees a task. Used by the creator API (task list, joining, announcements)
// and by the admin panel ("this task will be shown to N creators").
// Pure functions: no database, no clock.

import type { Level } from './types.js';

export interface Audience {
  /** all: everyone. segment: everyone who fits every filter that is set. list: only userIds. */
  mode: 'all' | 'segment' | 'list';
  /** Any of these cities. Empty or missing: any city. */
  cities?: string[];
  /** Instagram followers, inclusive. null or missing: no bound. */
  followersMin?: number | null;
  followersMax?: number | null;
  /** Any of these levels. Empty or missing: any level. */
  levels?: Level[];
  /** Creator must carry at least one of these tags. Empty or missing: any. */
  tags?: string[];
  /** mode 'list' only: Telegram ids of the chosen creators. */
  userIds?: number[];
}

export interface AudienceSubject {
  id: number;
  city: string | null;
  level: Level;
  /** Instagram followers from the pulled profile. null when unknown. */
  followers: number | null;
  tags: string[];
}

export const EVERYONE: Audience = { mode: 'all' };

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Reads the JSON stored in tasks.audience. Anything broken means "everyone", never "nobody". */
export function parseAudience(json: string | null | undefined): Audience {
  if (!json) return EVERYONE;
  try {
    const raw = JSON.parse(json) as Partial<Audience> | null;
    if (!raw || typeof raw !== 'object') return EVERYONE;
    const mode = raw.mode === 'segment' || raw.mode === 'list' ? raw.mode : 'all';
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
    const bound = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    return {
      mode,
      cities: strings(raw.cities),
      followersMin: bound(raw.followersMin),
      followersMax: bound(raw.followersMax),
      levels: strings(raw.levels).filter((level): level is Level => level === 'member' || level === 'pro' || level === 'partner'),
      tags: strings(raw.tags),
      userIds: Array.isArray(raw.userIds) ? raw.userIds.filter((id): id is number => Number.isInteger(id)) : [],
    };
  } catch {
    return EVERYONE;
  }
}

export function matchesAudience(subject: AudienceSubject, audience: Audience): boolean {
  if (audience.mode === 'all') return true;
  if (audience.mode === 'list') return (audience.userIds ?? []).includes(subject.id);

  const cities = audience.cities ?? [];
  if (cities.length && !(subject.city && cities.some((city) => same(city, subject.city!)))) return false;

  const levels = audience.levels ?? [];
  if (levels.length && !levels.includes(subject.level)) return false;

  const tags = audience.tags ?? [];
  if (tags.length && !tags.some((tag) => subject.tags.some((own) => same(own, tag)))) return false;

  const min = audience.followersMin ?? null;
  const max = audience.followersMax ?? null;
  if (min !== null || max !== null) {
    // A follower filter needs a known number: an unknown count does not fit.
    if (subject.followers === null) return false;
    if (min !== null && subject.followers < min) return false;
    if (max !== null && subject.followers > max) return false;
  }
  return true;
}
