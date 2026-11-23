// Background work on a timer: the follow-up measurements of publications, the copy of a
// story while it is live, the request for story views after 24 hours, the weekly refresh
// of profile data. Filled in by the creator workstream. See docs/V2-SPEC.md, "Measurements".
//
// One process runs everything, so a plain interval is enough. Every job must be safe to
// run twice and must never throw out of its tick.

import type { DB } from './db.js';

/** Starts the timers. Returns a function that stops them (used on shutdown and in tests). */
export function startJobs(_db: DB): () => void {
  return () => undefined;
}
