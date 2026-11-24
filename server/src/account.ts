// A creator's social accounts: the data we pull from their public profile, the team's
// confirmation that the account is really theirs, and the tags the team puts on them.
//
// OWNERSHIP: the creator workstream owns this file and fills in the two functions that
// throw below. The admin workstream only CALLS what is exported here and must not edit
// this file. The signatures are a contract: do not change them without updating
// docs/V2-SPEC.md.

import { randomBytes } from 'node:crypto';
import type { AudienceSubject } from './audience.js';
import { track, withTimeout } from './background.js';
import { settings } from './config.js';
import { isSampleId, now, type AccountStatus, type DB, type Platform, type SocialLookupRow, type SocialProfileRow, type UserRow } from './db.js';
import { HubError } from './errors.js';
import { downloadMedia, saveMedia } from './media.js';
import { accountKeyboard, creatorLine, esc, notifyAdmins, notifyUser } from './notify.js';
import { cleanHandle, getProvider } from './social/index.js';
import { mergeReelViews, type ProfileData, type ProfileResult, type RecentPost } from './social/types.js';
import type { ConnectView, Level } from './types.js';

export function profileOf(db: DB, userId: number, platform: Platform = 'instagram'): SocialProfileRow | undefined {
  return db.prepare('SELECT * FROM social_profiles WHERE user_id = ? AND platform = ?').get(userId, platform) as
    | SocialProfileRow
    | undefined;
}

export function tagsOf(db: DB, userId: number): string[] {
  return (db.prepare('SELECT tag FROM user_tags WHERE user_id = ? ORDER BY tag').all(userId) as Array<{ tag: string }>).map(
    (row) => row.tag,
  );
}

/** Replaces the creator's tags. Tags are trimmed, lower-cased, de-duplicated, at most 20 of 30 characters. */
export function setTags(db: DB, userId: number, tags: string[]): string[] {
  const clean = [...new Set(tags.map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20);
  db.transaction(() => {
    db.prepare('DELETE FROM user_tags WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO user_tags (user_id, tag) VALUES (?, ?)');
    for (const tag of clean) insert.run(userId, tag);
  })();
  return clean;
}

/**
 * Tags chosen when someone was invited from the admin site are put on them once they show up
 * in the Hub: when they finish the setup, and whenever the admin reads creators or audiences.
 * Safe to call any time; each invitation's tags are applied once.
 */
export function applyInviteTags(db: DB): void {
  const waiting = db
    .prepare(
      `SELECT i.id, i.telegram_id, i.tags FROM invites i JOIN users u ON u.id = i.telegram_id
       WHERE i.tags IS NOT NULL AND i.tags_applied_at IS NULL`,
    )
    .all() as Array<{ id: number; telegram_id: number; tags: string }>;
  if (!waiting.length) return;
  const insert = db.prepare('INSERT OR IGNORE INTO user_tags (user_id, tag) VALUES (?, ?)');
  const done = db.prepare('UPDATE invites SET tags_applied_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of waiting) {
      let tags: unknown = [];
      try {
        tags = JSON.parse(row.tags);
      } catch {
        // A broken value means no tags, never a crash.
      }
      if (Array.isArray(tags)) {
        for (const tag of tags) if (typeof tag === 'string' && tag) insert.run(row.telegram_id, tag.slice(0, 30).toLowerCase());
      }
      done.run(now(), row.id);
    }
  })();
}

/** What the audience filter needs to know about one creator. */
export function audienceSubject(db: DB, user: UserRow, level: Level): AudienceSubject {
  return {
    id: user.id,
    city: user.city,
    level,
    followers: profileOf(db, user.id, 'instagram')?.followers ?? null,
    tags: tagsOf(db, user.id),
  };
}

// --- Set up ------------------------------------------------------------------

/**
 * A member is set up when they finished the setup, answered the age question and have a
 * connected Instagram profile. Members from before the age question and the profile pull
 * (v1) are short of that: they go through the setup again, keeping all their history.
 */
export function isSetUp(db: DB, user: Pick<UserRow, 'id' | 'onboarded_at' | 'birth_date'>): boolean {
  return Boolean(
    user.onboarded_at &&
      user.birth_date &&
      db.prepare(`SELECT 1 FROM social_profiles WHERE user_id = ? AND platform = 'instagram'`).get(user.id),
  );
}

// --- Age ---------------------------------------------------------------------

/** The calendar date today in the hub's time zone, as YYYY-MM-DD. */
function today(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Full years between a birth date and a day, both YYYY-MM-DD. */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = day.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** A real calendar date, not in the future, not before 1900. Anything else is refused. */
export function parseBirthDate(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(`${text}T00:00:00Z`) : null;
  const real = date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
  if (!real || text > today() || text < '1900-01-01') {
    throw new HubError('bad_birth_date', 'Enter your date of birth: day, month and year.');
  }
  return text;
}

/** The team's undo for an age refusal (an adult's typo). True when there was a refusal to lift. */
export function allowAgeAgain(db: DB, telegramId: number): boolean {
  return db.prepare('DELETE FROM age_refusals WHERE telegram_id = ?').run(telegramId).changes > 0;
}

export function isAgeRefused(db: DB, telegramId: number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM age_refusals WHERE telegram_id = ?').get(telegramId));
}

/**
 * Refuses someone under the minimum age. We keep only the fact that this Telegram id was
 * refused (so a second try with another date does not work) and drop everything else we
 * hold about them, the birth date first of all, which is never stored.
 */
export function refuseForAge(db: DB, userId: number): void {
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO age_refusals (telegram_id, created_at) VALUES (?, ?)').run(userId, now());
    for (const table of ['social_lookups', 'social_profiles', 'user_tags', 'reminders', 'rsvps']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    try {
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    } catch {
      // Rows elsewhere still point at this account (it took part before the age question
      // existed): keep the id for them, wipe everything personal.
      db.prepare(
        `UPDATE users SET username = NULL, first_name = '', instagram = NULL, tiktok = NULL, city = NULL, size = NULL,
           address = NULL, phone = NULL, birth_date = NULL, avatar_url = NULL, pending = NULL, onboarded_at = NULL WHERE id = ?`,
      ).run(userId);
    }
  })();
}

// --- Profile data ----------------------------------------------------------------

/** How long we wait for the provider before telling the creator to try again. */
const PROVIDER_WAIT_MS = 200_000;
/** A lookup that has not answered in this time is reported as failed (the process may have restarted). */
const LOOKUP_STALE_MS = 5 * 60_000;
/** Each lookup costs money: a creator gets this many a day. */
const LOOKUPS_PER_DAY = 20;

/** Average reel views and engagement over the latest publications (settings.metrics.profileSample). */
export function profileAverages(
  recent: RecentPost[],
  followers: number | null,
  sample = settings.metrics.profileSample,
): { avgReelViews: number | null; engagementRate: number | null } {
  const latest = [...recent]
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, Math.max(1, sample));
  const views = latest.filter((post) => post.views !== null).map((post) => post.views!);
  const avgReelViews = views.length ? Math.round(views.reduce((sum, value) => sum + value, 0) / views.length) : null;
  const engaged = latest.filter((post) => post.likes !== null);
  const engagementRate =
    followers && engaged.length
      ? Math.round(
          (engaged.reduce((sum, post) => sum + (post.likes! + (post.comments ?? 0)) / followers, 0) / engaged.length) * 1000,
        ) / 10
      : null;
  return { avgReelViews, engagementRate };
}

/** Our own copy of a profile picture: remote ones expire within days. null when it cannot be had. */
async function keepAvatar(remote: string | null): Promise<string | null> {
  if (!remote) return null;
  const bytes = await downloadMedia(remote, 5 * 1024 * 1024);
  if (!bytes) return null;
  try {
    return (await saveMedia('public', 'avatars', bytes, { maxBytes: 5 * 1024 * 1024, allow: ['jpg', 'png', 'webp'] })).url;
  } catch {
    return null;
  }
}

async function askProvider(platform: Platform, handle: string): Promise<ProfileResult> {
  try {
    return await withTimeout(getProvider().fetchProfile(platform, handle), PROVIDER_WAIT_MS, 'profile lookup');
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

function writeProfile(db: DB, userId: number, profile: ProfileData, avatarUrl: string | null, source: 'apify' | 'demo'): void {
  const { avgReelViews, engagementRate } = profileAverages(profile.recent, profile.followers);
  db.prepare(
    `INSERT INTO social_profiles (user_id, platform, handle, external_id, full_name, bio, avatar_url, followers, following,
       posts_count, is_private, is_verified, avg_reel_views, engagement_rate, recent, status, source, fetched_at)
     VALUES (@userId, @platform, @handle, @externalId, @fullName, @bio, @avatarUrl, @followers, @following,
       @postsCount, @isPrivate, @isVerified, @avgReelViews, @engagementRate, @recent, 'ok', @source, @now)
     ON CONFLICT(user_id, platform) DO UPDATE SET handle = excluded.handle, external_id = excluded.external_id,
       full_name = excluded.full_name, bio = excluded.bio, avatar_url = COALESCE(excluded.avatar_url, social_profiles.avatar_url),
       followers = excluded.followers, following = excluded.following, posts_count = excluded.posts_count,
       is_private = excluded.is_private, is_verified = excluded.is_verified, avg_reel_views = excluded.avg_reel_views,
       engagement_rate = excluded.engagement_rate, recent = excluded.recent, status = 'ok', source = excluded.source,
       fetched_at = excluded.fetched_at`,
  ).run({
    userId,
    platform: profile.platform,
    handle: profile.handle,
    externalId: profile.externalId,
    fullName: profile.fullName?.slice(0, 200) ?? null,
    bio: profile.bio?.slice(0, 1000) ?? null,
    avatarUrl,
    followers: profile.followers,
    following: profile.following,
    postsCount: profile.postsCount,
    isPrivate: profile.isPrivate ? 1 : 0,
    isVerified: profile.isVerified ? 1 : 0,
    avgReelViews,
    engagementRate,
    recent: JSON.stringify(profile.recent.slice(0, 30)),
    source,
    now: now(),
  });
}

/**
 * Reads the creator's public profile again and stores it (numbers, avatar, recent posts).
 * Returns the stored row, or null when the creator has no handle for that platform.
 * Never throws for provider trouble: the row's status says what happened.
 */
export async function refreshProfile(db: DB, userId: number, platform: Platform = 'instagram'): Promise<SocialProfileRow | null> {
  const before = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  const handle = platform === 'instagram' ? before?.instagram : before?.tiktok;
  if (!before || !handle) return null;
  // A sample creator's handle is made up: the stored numbers are all there is.
  if (isSampleId(userId)) return profileOf(db, userId, platform) ?? null;
  // An Instagram profile row is written first by "Yes, this is me" (it is part of being set up):
  // a refresh never creates one for someone who has not confirmed their account.
  if (platform === 'instagram' && !profileOf(db, userId, 'instagram')) return null;

  const provider = getProvider();
  const result = await askProvider(platform, handle);
  const avatarUrl = result.status === 'ok' ? await keepAvatar(result.profile.avatarUrl) : null;
  // Reel views come from a second, slower read: the profile's own list of posts has none.
  if (result.status === 'ok' && platform === 'instagram' && provider.fetchReels) {
    try {
      const reels = await withTimeout(provider.fetchReels(handle, settings.metrics.profileSample), PROVIDER_WAIT_MS, 'reel views');
      result.profile.recent = mergeReelViews(result.profile.recent, reels);
    } catch {
      // No numbers this time: the profile is stored without them.
    }
  }

  // The creator may have changed the handle while we were reading: then this answer is stale.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user || (platform === 'instagram' ? user.instagram : user.tiktok) !== handle) return profileOf(db, userId, platform) ?? null;

  if (result.status === 'ok') {
    db.transaction(() => {
      writeProfile(db, userId, { ...result.profile, handle }, avatarUrl, provider.name);
      if (platform === 'instagram' && avatarUrl) db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, userId);
    })();
  } else {
    // Keep the last good numbers; only say what happened now (the admin flags "went private").
    db.prepare(
      `INSERT INTO social_profiles (user_id, platform, handle, is_private, status, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, platform) DO UPDATE SET handle = excluded.handle, status = excluded.status,
         is_private = CASE WHEN excluded.status = 'private' THEN 1 WHEN excluded.status = 'error' THEN social_profiles.is_private ELSE 0 END,
         fetched_at = excluded.fetched_at`,
    ).run(userId, platform, handle, result.status === 'private' ? 1 : 0, result.status, provider.name, now());
  }
  return profileOf(db, userId, platform) ?? null;
}

// --- Connecting the Instagram account -----------------------------------------------

/** The Hub account that already holds this handle, if any. A rejected claim does not hold it. */
export function handleOwner(db: DB, handle: string, exceptUserId: number): number | null {
  const row = db
    .prepare(
      `SELECT id FROM users WHERE lower(instagram) = lower(?) AND id != ? AND onboarded_at IS NOT NULL AND account_status != 'rejected' LIMIT 1`,
    )
    .get(handle, exceptUserId) as { id: number } | undefined;
  return row?.id ?? null;
}

interface StoredLookup extends ProfileData {
  source: 'apify' | 'demo';
}

function lookupOf(db: DB, userId: number): SocialLookupRow | undefined {
  return db.prepare('SELECT * FROM social_lookups WHERE user_id = ?').get(userId) as SocialLookupRow | undefined;
}

export function connectView(db: DB, userId: number): ConnectView {
  const row = lookupOf(db, userId);
  if (!row) return { status: 'idle', handle: null, profile: null };
  if (row.status === 'searching') {
    const stale = Date.now() - new Date(row.started_at).getTime() > LOOKUP_STALE_MS;
    return { status: stale ? 'error' : 'searching', handle: row.handle, profile: null };
  }
  if (row.status !== 'ok' || !row.result) return { status: row.status === 'ok' ? 'error' : row.status, handle: row.handle, profile: null };
  const found = JSON.parse(row.result) as StoredLookup;
  return {
    status: 'found',
    handle: row.handle,
    profile: { handle: found.handle, fullName: found.fullName, avatarUrl: found.avatarUrl, followers: found.followers, postsCount: found.postsCount },
  };
}

async function runLookup(db: DB, userId: number, attempt: string, handle: string): Promise<void> {
  const provider = getProvider();
  const result = await askProvider('instagram', handle);
  let stored: StoredLookup | null = null;
  if (result.status === 'ok') {
    // The creator sees the picture on the "Is this you?" card, so we keep our copy now.
    stored = { ...result.profile, handle, avatarUrl: await keepAvatar(result.profile.avatarUrl), source: provider.name };
  }
  db.prepare(`UPDATE social_lookups SET status = ?, result = ?, finished_at = ? WHERE user_id = ? AND attempt = ?`).run(
    result.status,
    stored ? JSON.stringify(stored) : null,
    now(),
    userId,
    attempt,
  );
}

/**
 * "Find my profile". On the first setup the date of birth comes with it, and someone under
 * the minimum age is refused here. The lookup itself runs in the background: the app polls
 * connectView until it is no longer 'searching'.
 */
export function startLookup(db: DB, user: UserRow, body: Record<string, unknown>): ConnectView {
  if (!user.birth_date) {
    const birthDate = parseBirthDate(body.birthDate);
    if (ageOn(birthDate, today()) < settings.minAge) {
      refuseForAge(db, user.id);
      throw new HubError('age_refused', `The Hub is open to people aged ${settings.minAge} and over.`, 403);
    }
    db.prepare('UPDATE users SET birth_date = ? WHERE id = ?').run(birthDate, user.id);
  }

  const handle = cleanHandle(body.instagram);
  if (!handle) throw new HubError('bad_handle', 'Enter your Instagram handle: letters, numbers, dots and underscores.');
  if (handleOwner(db, handle, user.id)) {
    throw new HubError('handle_taken', 'This account is already connected to another member of the Hub. Write to the team if it is yours.', 409);
  }

  const day = today();
  const previous = lookupOf(db, user.id);
  const used = previous?.day === day ? previous.count : 0;
  if (previous?.status === 'searching' && previous.handle === handle && connectView(db, user.id).status === 'searching') {
    return connectView(db, user.id);
  }
  if (used >= LOOKUPS_PER_DAY) {
    throw new HubError('too_many_lookups', 'That is a lot of tries for one day. Please try again tomorrow, or write to the team.', 429);
  }

  const attempt = randomBytes(8).toString('hex');
  db.prepare(
    `INSERT INTO social_lookups (user_id, platform, handle, attempt, status, result, started_at, finished_at, day, count)
     VALUES (?, 'instagram', ?, ?, 'searching', NULL, ?, NULL, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, attempt = excluded.attempt, status = 'searching',
       result = NULL, started_at = excluded.started_at, finished_at = NULL, day = excluded.day, count = excluded.count`,
  ).run(user.id, handle, attempt, now(), day, used + 1);
  track('profile lookup', runLookup(db, user.id, attempt, handle));
  return connectView(db, user.id);
}

const cleanCity = (value: unknown): string | null => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 80) : null;
};

/**
 * "Yes, this is me". Stores the profile, makes the handle the creator's, finishes the first
 * setup (city and an optional TikTok handle come with it), and puts the account in the team's
 * queue for confirmation. Changing to another handle later sends it back to 'pending'.
 */
export function confirmLookup(db: DB, user: UserRow, body: Record<string, unknown>): void {
  const row = lookupOf(db, user.id);
  if (!row || row.status !== 'ok' || !row.result) throw new HubError('lookup_not_ready', 'Find your profile first.');
  const found = JSON.parse(row.result) as StoredLookup;

  const firstSetup = !isSetUp(db, user);
  const city = cleanCity(body.city);
  if (firstSetup && !city && !user.city) throw new HubError('city_required', 'Choose your city.');
  const tiktokGiven = typeof body.tiktok === 'string' && body.tiktok.trim() !== '';
  const tiktok = tiktokGiven ? cleanHandle(body.tiktok) : null;
  if (tiktokGiven && !tiktok) throw new HubError('bad_handle', 'That TikTok handle does not look right: letters, numbers, dots and underscores.');
  if (handleOwner(db, found.handle, user.id)) {
    throw new HubError('handle_taken', 'This account is already connected to another member of the Hub. Write to the team if it is yours.', 409);
  }

  const sameHandle = user.instagram?.toLowerCase() === found.handle;
  const backToPending = !sameHandle || user.account_status === 'rejected';
  db.transaction(() => {
    writeProfile(db, user.id, found, found.avatarUrl, found.source);
    db.prepare(
      `UPDATE users SET instagram = ?, avatar_url = COALESCE(?, CASE WHEN ? THEN avatar_url ELSE NULL END),
         city = COALESCE(?, city), tiktok = CASE WHEN ? THEN ? ELSE tiktok END, onboarded_at = COALESCE(onboarded_at, ?)
       WHERE id = ?`,
    ).run(found.handle, found.avatarUrl, sameHandle ? 1 : 0, city, tiktokGiven ? 1 : 0, tiktok, now(), user.id);
    db.prepare('DELETE FROM social_lookups WHERE user_id = ?').run(user.id);
    if (backToPending) setAccountStatus(db, user.id, 'pending', 0);
  })();
  // Tags the team chose when inviting this person start working now: tasks for a tag reach them at once.
  applyInviteTags(db);
  // "Is this you?" is answered from the quick profile read. The reel views behind the averages
  // need a slower one, so they are filled in now, in the background, before the team looks.
  if (getProvider().fetchReels) track('reel views after connect', refreshProfile(db, user.id, 'instagram'));

  // The team hears about every account it has not confirmed yet, including members from v1.
  if (!backToPending && user.account_status === 'confirmed') return;
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
  const numbers = [
    found.followers !== null ? `${found.followers.toLocaleString('en-US')} followers` : null,
    found.postsCount !== null ? `${found.postsCount.toLocaleString('en-US')} posts` : null,
    found.source === 'demo' ? 'sample data, no provider token' : null,
  ]
    .filter(Boolean)
    .join(', ');
  void notifyAdmins(
    db,
    [
      `<b>${firstSetup ? 'New account to confirm' : 'Changed Instagram account to confirm'}</b>`,
      `Creator: ${creatorLine(fresh)}`,
      numbers ? esc(numbers) : '',
      'Check that the account is theirs, then confirm or reject it with the buttons below or in the admin panel. Until then their work cannot be approved.',
    ]
      .filter(Boolean)
      .join('\n'),
    accountKeyboard(user.id),
  );
}

// --- The team's decision --------------------------------------------------------------

const STATUSES: AccountStatus[] = ['pending', 'confirmed', 'rejected'];

/**
 * The team's decision on whether the account belongs to the creator.
 * Stores who decided and when, and tells the creator in the bot:
 *   confirmed: "Your account is confirmed", tasks pay out from now on
 *   rejected:  "We could not confirm your account", with the note and a button to change the handle
 *   pending:   silent (used when the creator changes their handle)
 * `by` is the Telegram id of the team member, or 0 for the system.
 */
export function setAccountStatus(db: DB, userId: number, status: AccountStatus, by: number, note?: string | null): void {
  if (!STATUSES.includes(status)) throw new HubError('bad_status', 'Unknown account status.');
  const cleanNote = note?.trim().slice(0, 500) || null;
  const result = db
    .prepare('UPDATE users SET account_status = ?, account_note = ?, account_reviewed_by = ?, account_reviewed_at = ? WHERE id = ?')
    .run(status, status === 'rejected' ? cleanNote : null, by, now(), userId);
  if (!result.changes) throw new HubError('user_not_found', 'This creator does not exist.', 404);

  if (status === 'confirmed') {
    void notifyUser(userId, '<b>Your account is confirmed.</b> Tasks pay out from now on.', { text: 'Open tasks', path: '/tasks' });
  } else if (status === 'rejected') {
    void notifyUser(
      userId,
      [
        '<b>We could not confirm your account.</b>',
        cleanNote ? `The team says: ${esc(cleanNote)}` : '',
        'Connect the Instagram account that is really yours, and we will look again.',
      ]
        .filter(Boolean)
        .join('\n'),
      { text: 'Change the handle', path: '/profile/instagram' },
    );
  }
}

/** Starts a background refresh unless the profile was read recently. Used when work is submitted. */
export function refreshSoon(db: DB, userId: number, olderThanMs: number): void {
  const row = profileOf(db, userId, 'instagram');
  if (row && Date.now() - new Date(row.fetched_at).getTime() < olderThanMs) return;
  track('profile refresh', refreshProfile(db, userId, 'instagram'));
}
