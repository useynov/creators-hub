// Real public data through Apify actors. See docs/DATA-PROVIDER.md for the actors, their
// inputs and outputs, and what one call costs.
//
// The token goes in the Authorization header only: never in a URL, never in a log line.
// Every field of an actor's output is treated as optional and of unknown type: the actors
// change their output now and then, and a missing number must become null, not a crash.

import type { Platform, PublicationKind } from '../db.js';
import { cleanHandle, parseLink, type LinkInfo } from './links.js';
import type { PostData, PostResult, ProfileData, ProfileResult, RecentPost, SocialProvider } from './types.js';

export const ACTORS = {
  instagramProfile: 'apify~instagram-profile-scraper',
  /** The profile reader lists recent posts without view counts; this one returns reels with their plays. */
  instagramReels: 'apify~instagram-reel-scraper',
  instagramPost: 'apify~instagram-scraper',
  /** The official Instagram actors no longer read stories (deprecated 26 Nov 2025). This one reads them without a login. */
  instagramStories: 'memo23~instagram-stories-highlights-scraper',
  tiktok: 'clockworks~tiktok-scraper',
} as const;

const API = 'https://api.apify.com/v2/acts';
/** Apify answers a synchronous run within 300 seconds or gives up with 408. */
const RUN_TIMEOUT_SECONDS = 240;

type Item = Record<string, unknown>;
type Fetch = typeof fetch;

// --- Defensive readers ---------------------------------------------------------

const isObject = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
/** Counts. Instagram reports -1 when likes are hidden: that is "unknown", not a number. */
const count = (value: unknown): number | null => {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};
const bool = (value: unknown): boolean => value === true || value === 'true';
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** ISO time from an ISO string or unix seconds. */
const time = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value * 1000).toISOString();
  const text = str(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
/** Lower-case names without @ or #, from strings or objects with a username/name field. */
const names = (value: unknown): string[] =>
  list(value)
    .map((item) => (isObject(item) ? (str(item.username) ?? str(item.name)) : str(item)))
    .filter((item): item is string => Boolean(item))
    .map((item) => item.replace(/^[@#]+/, '').toLowerCase());
const unique = (values: string[]): string[] => [...new Set(values)];

/** An item that carries an error instead of data, e.g. { error: 'not_found', errorDescription: '...' }. */
function errorOf(item: Item): string | null {
  const parts = [str(item.error), str(item.errorDescription), str(item.errorCode), str(item.errorMessage)].filter(Boolean);
  return parts.length ? parts.join(': ') : null;
}
const saysPrivate = (text: string): boolean => /private|restricted/i.test(text);
const saysMissing = (text: string): boolean => /not.?found|does not exist|doesn't exist|no.?longer|unavailable|deleted|empty/i.test(text);

// --- Instagram -------------------------------------------------------------------

function igKind(item: Item): PublicationKind {
  const type = str(item.type)?.toLowerCase();
  const product = str(item.productType)?.toLowerCase();
  if (product === 'clips' || product === 'igtv' || type === 'video') return 'reel';
  if (type === 'image' || type === 'sidecar') return 'post';
  return 'unknown';
}

/** A reel's public view count. Plays are what Instagram shows today, older output only has views. */
const igViews = (item: Item, kind: PublicationKind): number | null =>
  kind === 'reel' ? (count(item.videoPlayCount) ?? count(item.videoViewCount)) : null;

function igPostUrl(item: Item): string | null {
  const url = str(item.url);
  if (url) return url;
  const code = str(item.shortCode);
  return code ? `https://www.instagram.com/p/${code}/` : null;
}

function igRecent(item: Item): RecentPost | null {
  const url = igPostUrl(item);
  if (!url) return null;
  const kind = igKind(item);
  return {
    url,
    kind,
    publishedAt: time(item.timestamp),
    views: igViews(item, kind),
    likes: count(item.likesCount),
    comments: count(item.commentsCount),
    thumbUrl: str(item.displayUrl),
  };
}

/** Output of apify/instagram-profile-scraper for one username. */
export function mapInstagramProfile(items: unknown[], handle: string): ProfileResult {
  const wanted = handle.toLowerCase();
  const objects = items.filter(isObject);
  const item = objects.find((candidate) => str(candidate.username)?.toLowerCase() === wanted);
  // A missing account comes back as an item with the username AND an error
  // ({ username, error: 'not_found', errorDescription: 'Profile does not exist' }),
  // so the error is read before the item is trusted as a profile.
  const failure = (item ? errorOf(item) : null) ?? (item ? null : objects.map(errorOf).find(Boolean)) ?? null;
  if (failure || !item) {
    if (failure && saysPrivate(failure)) return { status: 'private', handle: wanted };
    if (!failure || saysMissing(failure)) return { status: 'not_found', handle: wanted };
    return { status: 'error', message: 'The profile reader returned an error' };
  }
  if (bool(item.private)) return { status: 'private', handle: wanted };
  // A real profile always has an id and a follower count. Without both there is nothing to show
  // the creator as "Is this you?", and nobody is let in on an empty answer.
  if (item.id == null && count(item.followersCount) === null) return { status: 'not_found', handle: wanted };

  const profile: ProfileData = {
    platform: 'instagram',
    handle: wanted,
    externalId: str(item.id) ?? (typeof item.id === 'number' ? String(item.id) : null),
    fullName: str(item.fullName),
    bio: str(item.biography),
    avatarUrl: str(item.profilePicUrlHD) ?? str(item.profilePicUrl),
    followers: count(item.followersCount),
    following: count(item.followsCount),
    postsCount: count(item.postsCount),
    isPrivate: false,
    isVerified: bool(item.verified),
    recent: list(item.latestPosts).filter(isObject).map(igRecent).filter((post): post is RecentPost => Boolean(post)),
  };
  return { status: 'ok', profile };
}

/** Output of apify/instagram-scraper for one post or reel link. */
export function mapInstagramPost(items: unknown[], url: string, info: LinkInfo): PostResult {
  const objects = items.filter(isObject);
  const item = objects.find((candidate) => !errorOf(candidate) && (str(candidate.shortCode) || str(candidate.url)));
  if (!item) {
    const failure = objects.map(errorOf).find(Boolean);
    // Nothing back, "not found" or "restricted": the post is not there for the public.
    if (!failure || saysMissing(failure) || saysPrivate(failure)) return { status: 'gone' };
    return { status: 'error', message: 'The post reader returned an error' };
  }
  const kind = igKind(item) === 'unknown' ? info.kind : igKind(item);
  const caption = str(item.caption);
  const post: PostData = {
    url,
    platform: 'instagram',
    kind,
    externalId: str(item.shortCode) ?? str(item.id) ?? info.id,
    authorHandle: cleanHandle(item.ownerUsername) ?? info.author,
    publishedAt: time(item.timestamp),
    caption,
    mentions: unique([...names(item.mentions), ...names(item.taggedUsers)]),
    hashtags: unique(names(item.hashtags)),
    views: igViews(item, kind),
    likes: count(item.likesCount),
    comments: count(item.commentsCount),
    shares: null,
    thumbUrl: str(item.displayUrl),
    mediaUrl: null,
  };
  return { status: 'ok', post };
}

/** Output of memo23/instagram-stories-highlights-scraper for the story's author. */
export function mapInstagramStory(items: unknown[], url: string, info: LinkInfo): PostResult {
  const objects = items.filter(isObject);
  const item = objects.find(
    (candidate) =>
      (str(candidate.type) ?? 'story') === 'story' &&
      [str(candidate.mediaPk), str(candidate.id), count(candidate.mediaPk)?.toString()].includes(info.id ?? '-'),
  );
  // Stories live 24 hours. Not in the list of live stories means expired or deleted.
  if (!item) {
    const failure = objects.map(errorOf).find(Boolean);
    if (failure && !saysMissing(failure) && !saysPrivate(failure)) return { status: 'error', message: 'The story reader returned an error' };
    return { status: 'gone' };
  }
  const post: PostData = {
    url,
    platform: 'instagram',
    kind: 'story',
    externalId: info.id,
    authorHandle: cleanHandle(item.sourceUsername) ?? info.author,
    publishedAt: time(item.takenAt),
    caption: null,
    mentions: unique(names(item.mentions)),
    hashtags: unique(names(item.hashtags)),
    // Only the author can see who watched a story: the creator tells us the number later.
    views: null,
    likes: null,
    comments: null,
    shares: null,
    thumbUrl: str(item.imageUrl),
    mediaUrl: str(item.videoUrl) ?? str(item.imageUrl),
  };
  return { status: 'ok', post };
}

// --- TikTok ----------------------------------------------------------------------

const tiktokAuthor = (item: Item): Item => (isObject(item.authorMeta) ? item.authorMeta : {});

function tiktokRecent(item: Item): RecentPost | null {
  const url = str(item.webVideoUrl);
  if (!url) return null;
  return {
    url,
    kind: 'tiktok',
    publishedAt: time(item.createTimeISO) ?? time(item.createTime),
    views: count(item.playCount),
    likes: count(item.diggCount),
    comments: count(item.commentCount),
    thumbUrl: isObject(item.videoMeta) ? str(item.videoMeta.coverUrl) : null,
  };
}

/** Output of clockworks/tiktok-scraper with `profiles`: one item per video, each carrying authorMeta. */
export function mapTiktokProfile(items: unknown[], handle: string): ProfileResult {
  const wanted = handle.toLowerCase();
  const objects = items.filter(isObject);
  const videos = objects.filter((item) => !errorOf(item) && str(tiktokAuthor(item).name)?.toLowerCase() === wanted);
  if (!videos.length) {
    const failure = objects.map(errorOf).find(Boolean);
    if (failure && saysPrivate(failure)) return { status: 'private', handle: wanted };
    if (!failure || saysMissing(failure)) return { status: 'not_found', handle: wanted };
    return { status: 'error', message: 'The profile reader returned an error' };
  }
  const author = tiktokAuthor(videos[0]!);
  if (bool(author.privateAccount)) return { status: 'private', handle: wanted };
  return {
    status: 'ok',
    profile: {
      platform: 'tiktok',
      handle: wanted,
      externalId: str(author.id),
      fullName: str(author.nickName),
      bio: str(author.signature),
      avatarUrl: str(author.originalAvatarUrl) ?? str(author.avatar),
      followers: count(author.fans),
      following: count(author.following),
      postsCount: count(author.video),
      isPrivate: false,
      isVerified: bool(author.verified),
      recent: videos.map(tiktokRecent).filter((post): post is RecentPost => Boolean(post)),
    },
  };
}

/** Output of clockworks/tiktok-scraper with `postURLs`. */
export function mapTiktokPost(items: unknown[], url: string, info: LinkInfo): PostResult {
  const objects = items.filter(isObject);
  const item = objects.find((candidate) => !errorOf(candidate) && (str(candidate.id) || str(candidate.webVideoUrl)));
  if (!item) {
    const failure = objects.map(errorOf).find(Boolean);
    if (!failure || saysMissing(failure) || saysPrivate(failure)) return { status: 'gone' };
    return { status: 'error', message: 'The video reader returned an error' };
  }
  const author = tiktokAuthor(item);
  return {
    status: 'ok',
    post: {
      url,
      platform: 'tiktok',
      kind: 'tiktok',
      externalId: str(item.id) ?? info.id,
      authorHandle: cleanHandle(author.name) ?? info.author,
      publishedAt: time(item.createTimeISO) ?? time(item.createTime),
      caption: str(item.text),
      mentions: unique(names(item.mentions)),
      hashtags: unique(names(item.hashtags)),
      views: count(item.playCount),
      likes: count(item.diggCount),
      comments: count(item.commentCount),
      shares: count(item.shareCount),
      thumbUrl: isObject(item.videoMeta) ? str(item.videoMeta.coverUrl) : null,
      mediaUrl: null,
    },
  };
}

// --- Calling Apify -----------------------------------------------------------------

/** A failed call. The message never contains the token or the input. */
class ApifyError extends Error {}

export function createApifyProvider(token: string, fetchImpl: Fetch = fetch): SocialProvider {
  async function run(actor: string, input: Record<string, unknown>): Promise<unknown[]> {
    const response = await fetchImpl(`${API}/${actor}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECONDS}&format=json`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((RUN_TIMEOUT_SECONDS + 30) * 1000),
    });
    if (!response.ok) throw new ApifyError(`Apify answered ${response.status} for ${actor}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new ApifyError(`Apify returned no item list for ${actor}`);
    return body;
  }

  const failure = (error: unknown) => ({
    status: 'error' as const,
    message: error instanceof ApifyError ? error.message : 'Could not reach the data provider',
  });

  return {
    name: 'apify',

    async fetchProfile(platform: Platform, handle: string): Promise<ProfileResult> {
      try {
        if (platform === 'tiktok') {
          const items = await run(ACTORS.tiktok, { profiles: [handle], resultsPerPage: 12, profileScrapeSections: ['videos'] });
          return mapTiktokProfile(items, handle);
        }
        return mapInstagramProfile(await run(ACTORS.instagramProfile, { usernames: [handle] }), handle);
      } catch (error) {
        return failure(error);
      }
    },

    async fetchReels(handle: string, limit: number): Promise<RecentPost[]> {
      const wanted = cleanHandle(handle);
      if (!wanted) return [];
      try {
        const items = await run(ACTORS.instagramReels, { username: [wanted], resultsLimit: Math.max(1, Math.min(30, Math.round(limit))) });
        return items
          .filter(isObject)
          .filter((item) => !errorOf(item) && str(item.ownerUsername)?.toLowerCase() === wanted)
          .map(igRecent)
          .filter((post): post is RecentPost => Boolean(post));
      } catch {
        // The averages simply stay as they were; the profile itself has been read already.
        return [];
      }
    },

    async fetchPost(url: string): Promise<PostResult> {
      const info = parseLink(url);
      try {
        if (info.platform === 'tiktok') {
          return mapTiktokPost(await run(ACTORS.tiktok, { postURLs: [url], resultsPerPage: 1 }), url, info);
        }
        if (info.platform === 'instagram' && info.kind === 'story' && info.author) {
          const items = await run(ACTORS.instagramStories, { usernames: [info.author], dataToScrape: 'stories', maxStoriesPerUser: 100 });
          return mapInstagramStory(items, url, info);
        }
        if (info.platform === 'instagram' && (info.kind === 'post' || info.kind === 'reel')) {
          const items = await run(ACTORS.instagramPost, { directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false });
          return mapInstagramPost(items, url, info);
        }
        return { status: 'unsupported' };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
