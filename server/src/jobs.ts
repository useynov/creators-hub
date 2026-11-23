// Background work on a timer: the follow-up measurements of publications, the request for
// story views after 24 hours, the weekly refresh of profile data, sends interrupted by a
// restart, and the copies of seed photos. See docs/V2-SPEC.md, "Measurements".
//
// One process runs everything, so a plain interval is enough. Every job is safe to run twice
// and never throws out of its tick. Nothing here starts on import: only startJobs (called
// from index.ts) or a test calling a job directly runs anything.

import { refreshProfile } from './account.js';
import { settings } from './config.js';
import type { DB } from './db.js';
import { localizeSeedPhotos } from './photos.js';
import { askForStoryViews, resumeStaleSubmissions, runDueSnapshots } from './pipeline.js';

const MINUTE = 60_000;
const TICK_MS = MINUTE;
const PHOTOS_EVERY_MS = 6 * 60 * MINUTE;
/** Profile refreshes cost money and time: a few per tick spreads the weekly round out. */
const PROFILES_PER_TICK = 3;

/** Creators whose profile data is older than settings.metrics.profileRefreshDays. Returns how many were read. */
export async function refreshDueProfiles(db: DB, nowIso = new Date().toISOString(), limit = PROFILES_PER_TICK): Promise<number> {
  const before = new Date(new Date(nowIso).getTime() - settings.metrics.profileRefreshDays * 24 * 60 * MINUTE).toISOString();
  const due = db
    .prepare(
      `SELECT u.id FROM users u LEFT JOIN social_profiles p ON p.user_id = u.id AND p.platform = 'instagram'
       WHERE u.onboarded_at IS NOT NULL AND u.instagram IS NOT NULL AND (p.fetched_at IS NULL OR p.fetched_at < ?)
       ORDER BY p.fetched_at IS NOT NULL, p.fetched_at LIMIT ?`,
    )
    .all(before, limit) as Array<{ id: number }>;
  for (const { id } of due) await refreshProfile(db, id, 'instagram');
  return due.length;
}

async function step(label: string, work: () => unknown): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[jobs] ${label} failed:`, (error as Error).message);
  }
}

/** Starts the timers. Returns a function that stops them (used on shutdown and in tests). */
export function startJobs(db: DB): () => void {
  let busy = false;
  let photosAt = 0;
  let stopped = false;

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (Date.now() - photosAt >= PHOTOS_EVERY_MS) {
        photosAt = Date.now();
        await step('seed photos', () => localizeSeedPhotos(db));
      }
      await step('stale sends', () => resumeStaleSubmissions(db));
      await step('measurements', () => runDueSnapshots(db));
      await step('story views', () => askForStoryViews(db));
      await step('profile refresh', () => refreshDueProfiles(db));
    } finally {
      busy = false;
    }
  };

  const first = setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), TICK_MS);
  first.unref();
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
  };
}
