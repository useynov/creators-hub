// Sample data for running the whole Hub without an Apify token: local preview, tests, demos.
// Everything is derived from the handle or the link, so the same input always gives the
// same answer. Rows written from this provider carry source 'demo' in the database.
//
// Special handles, for tests and for showing each screen:
//   a handle containing "private" answers that the profile is private
//   a handle containing "missing" answers that it does not exist
//   a handle containing "error" answers that the provider failed
// Links work the same way: a link containing "missing" is gone, "error" fails.

import type { Platform } from '../db.js';
import { parseLink } from './links.js';
import type { PostResult, ProfileResult, RecentPost, SocialProvider } from './types.js';

/** A small deterministic hash (FNV-1a), enough to spread sample numbers. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** A number in [min, max] picked by `seed`. */
const pick = (seed: string, min: number, max: number): number => min + (hash(seed) % (max - min + 1));

const titleCase = (handle: string): string => {
  const word = handle.split(/[._\d]/).find(Boolean) ?? handle;
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/** Fixed sample dates, so the same handle always gives the same recent posts. */
const SAMPLE_DAY = Date.UTC(2026, 10, 1);

export const demoProvider: SocialProvider = {
  name: 'demo',

  async fetchProfile(platform: Platform, handle: string): Promise<ProfileResult> {
    const clean = handle.toLowerCase();
    if (clean.includes('error')) return { status: 'error', message: 'Demo provider: simulated failure' };
    if (clean.includes('missing')) return { status: 'not_found', handle: clean };
    if (clean.includes('private')) return { status: 'private', handle: clean };

    const followers = pick(`${clean}:followers`, 900, 48_000);
    const recent: RecentPost[] = Array.from({ length: 12 }, (_, index) => {
      const isReel = platform === 'tiktok' || index % 3 !== 2;
      const reach = Math.round(followers * (pick(`${clean}:reach:${index}`, 40, 220) / 100));
      return {
        url:
          platform === 'tiktok'
            ? `https://www.tiktok.com/@${clean}/video/${7_400_000_000_000_000_000 + index}`
            : `https://www.instagram.com/${clean}/${isReel ? 'reel' : 'p'}/DEMO${index}${clean.length}/`,
        kind: platform === 'tiktok' ? 'tiktok' : isReel ? 'reel' : 'post',
        publishedAt: new Date(SAMPLE_DAY - index * 3 * 24 * 3600 * 1000).toISOString(),
        views: isReel ? reach : null,
        likes: Math.round(followers * (pick(`${clean}:likes:${index}`, 2, 9) / 100)),
        comments: pick(`${clean}:comments:${index}`, 3, 80),
        thumbUrl: null,
      };
    });

    return {
      status: 'ok',
      profile: {
        platform,
        handle: clean,
        externalId: String(hash(`${platform}:${clean}`)),
        fullName: titleCase(clean),
        bio: 'Sample profile: the Hub runs without a data provider token.',
        avatarUrl: null,
        followers,
        following: pick(`${clean}:following`, 120, 900),
        postsCount: pick(`${clean}:posts`, 40, 640),
        isPrivate: false,
        isVerified: false,
        recent,
      },
    };
  },

  async fetchPost(url: string): Promise<PostResult> {
    const info = parseLink(url);
    if (info.platform === 'other' || info.kind === 'unknown') return { status: 'unsupported' };
    const lower = url.toLowerCase();
    if (lower.includes('error')) return { status: 'error', message: 'Demo provider: simulated failure' };
    if (lower.includes('missing')) return { status: 'gone' };

    const hasViews = info.kind === 'reel' || info.kind === 'tiktok';
    return {
      status: 'ok',
      post: {
        url,
        platform: info.platform,
        kind: info.kind,
        externalId: info.id,
        // The address names the author only in some link formats. Without it we honestly do not know.
        authorHandle: info.author,
        publishedAt: null,
        caption: null,
        mentions: [],
        hashtags: [],
        views: hasViews ? pick(`${url}:views`, 800, 40_000) : null,
        likes: info.kind === 'story' ? null : pick(`${url}:likes`, 40, 2_500),
        comments: info.kind === 'story' ? null : pick(`${url}:comments`, 2, 120),
        shares: info.kind === 'tiktok' ? pick(`${url}:shares`, 0, 300) : null,
        thumbUrl: null,
        mediaUrl: null,
      },
    };
  },
};
