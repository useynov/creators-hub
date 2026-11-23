// The contract for reading PUBLIC Instagram and TikTok data. We never log in to a
// creator's account and never read their private statistics. Everything here is
// what any visitor of the profile could see.
//
// Implementations live next to this file:
//   apify.ts  real data through Apify actors (needs APIFY_TOKEN)
//   demo.ts   deterministic sample data, used when there is no token and in tests
// getProvider() in index.ts of this folder picks one.

import type { Platform, PublicationKind } from '../db.js';

/** One recent publication on a profile, used for the averages and the admin card. */
export interface RecentPost {
  url: string;
  kind: PublicationKind;
  /** ISO time */
  publishedAt: string | null;
  /** Reels and TikTok videos only. Photo posts have no public view count. */
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Remote thumbnail. Expires, so copy it if it must last. */
  thumbUrl: string | null;
}

export interface ProfileData {
  platform: Platform;
  handle: string;
  externalId: string | null;
  fullName: string | null;
  bio: string | null;
  /** Remote avatar. Expires within days: download it into the media folder. */
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  isPrivate: boolean;
  isVerified: boolean;
  recent: RecentPost[];
}

export type ProfileResult =
  | { status: 'ok'; profile: ProfileData }
  /** The account exists but is private: nothing else can be read. */
  | { status: 'private'; handle: string }
  | { status: 'not_found'; handle: string }
  /** The provider failed (network, quota). Not the creator's fault: let them retry. */
  | { status: 'error'; message: string };

/** What a link to one publication tells us. */
export interface PostData {
  url: string;
  platform: Platform;
  kind: PublicationKind;
  externalId: string | null;
  authorHandle: string | null;
  publishedAt: string | null;
  caption: string | null;
  /** Handles without @, lower case. From the caption, tagged users and story stickers. */
  mentions: string[];
  /** Tags without #, lower case. */
  hashtags: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  thumbUrl: string | null;
  /** Stories only: the media file to copy while the story is live. */
  mediaUrl: string | null;
}

export type PostResult =
  | { status: 'ok'; post: PostData }
  /** Deleted, expired (a story after 24 hours) or the account went private. */
  | { status: 'gone' }
  /** Not a link we can read (another site, a malformed link). */
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export interface SocialProvider {
  readonly name: 'apify' | 'demo';
  fetchProfile(platform: Platform, handle: string): Promise<ProfileResult>;
  fetchPost(url: string): Promise<PostResult>;
}

/** Result of one automatic check on a submitted link. */
export type CheckResult = 'pass' | 'fail' | 'unknown';

/**
 * Stored as JSON in publications.checks.
 * ownAccount 'fail' BLOCKS the submission. Every other 'fail' is only a flag for the reviewer.
 * 'unknown' means the data could not be read: also a flag, never a block.
 */
export interface LinkChecks {
  ownAccount: CheckResult;
  afterStart: CheckResult;
  /** 'pass' when the task requires no mention. */
  mention: CheckResult;
  /** 'pass' when the task requires no hashtag. */
  hashtag: CheckResult;
  /** The format is one the task accepts. 'pass' when the task accepts any. */
  format: CheckResult;
  reachable: CheckResult;
}
