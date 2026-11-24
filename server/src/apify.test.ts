import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTORS,
  createApifyProvider,
  mapInstagramPost,
  mapInstagramProfile,
  mapInstagramStory,
  mapTiktokPost,
  mapTiktokProfile,
} from './social/apify.js';
import { parseLink } from './social/links.js';
import { instagramCode, mergeReelViews, type RecentPost } from './social/types.js';

// Fixtures follow the output shapes documented on the actors' Apify pages (see docs/DATA-PROVIDER.md).
// They are trimmed to the fields we read, plus a few we ignore, the way the actors return them.

const igProfile = {
  inputUrl: 'https://www.instagram.com/aruzhan.vibes',
  id: '4815162342',
  username: 'aruzhan.vibes',
  url: 'https://www.instagram.com/aruzhan.vibes',
  fullName: 'Aruzhan',
  biography: 'Almaty · food, friends and winter walks',
  followersCount: 2840,
  followsCount: 512,
  postsCount: 214,
  highlightReelCount: 3,
  private: false,
  verified: false,
  isBusinessAccount: false,
  profilePicUrl: 'https://scontent.cdninstagram.com/small.jpg',
  profilePicUrlHD: 'https://scontent.cdninstagram.com/hd.jpg',
  latestPosts: [
    { id: '1', type: 'Video', productType: 'clips', shortCode: 'DReel1', url: 'https://www.instagram.com/p/DReel1/', timestamp: '2026-11-20T10:00:00.000Z', likesCount: 300, commentsCount: 20, videoViewCount: 900, videoPlayCount: 4100, displayUrl: 'https://scontent.cdninstagram.com/r1.jpg' },
    { id: '2', type: 'Image', shortCode: 'DPost1', timestamp: '2026-11-18T10:00:00.000Z', likesCount: -1, commentsCount: 4, displayUrl: 'https://scontent.cdninstagram.com/p1.jpg' },
    { id: '3', type: 'Sidecar', shortCode: 'DSide1', url: 'https://www.instagram.com/p/DSide1/', timestamp: '2026-11-16T10:00:00.000Z', likesCount: '120', commentsCount: 2 },
    { id: '4', type: 'Video', shortCode: 'DReel2', url: 'https://www.instagram.com/p/DReel2/', timestamp: '2026-11-10T10:00:00.000Z', likesCount: 80, commentsCount: null, videoViewCount: 2100 },
    'not an object',
    { id: '5', type: 'Image' },
  ],
};

test('apify: Instagram profile maps every field, and odd values become null', () => {
  const result = mapInstagramProfile([igProfile], 'Aruzhan.Vibes');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const profile = result.profile;
  assert.equal(profile.handle, 'aruzhan.vibes');
  assert.equal(profile.externalId, '4815162342');
  assert.equal(profile.fullName, 'Aruzhan');
  assert.equal(profile.avatarUrl, 'https://scontent.cdninstagram.com/hd.jpg', 'the HD picture wins');
  assert.deepEqual([profile.followers, profile.following, profile.postsCount], [2840, 512, 214]);
  assert.equal(profile.isPrivate, false);
  assert.equal(profile.recent.length, 4, 'items without a link are dropped');
  assert.deepEqual(profile.recent[0], {
    url: 'https://www.instagram.com/p/DReel1/',
    kind: 'reel',
    publishedAt: '2026-11-20T10:00:00.000Z',
    views: 4100,
    likes: 300,
    comments: 20,
    thumbUrl: 'https://scontent.cdninstagram.com/r1.jpg',
  });
  assert.equal(profile.recent[1]!.kind, 'post');
  assert.equal(profile.recent[1]!.url, 'https://www.instagram.com/p/DPost1/', 'built from the shortcode');
  assert.equal(profile.recent[1]!.likes, null, 'hidden likes (-1) are unknown');
  assert.equal(profile.recent[1]!.views, null, 'photo posts have no view count');
  assert.equal(profile.recent[2]!.likes, 120, 'numeric strings are read');
  assert.equal(profile.recent[3]!.views, 2100, 'older output only has videoViewCount');
});

test('apify: Instagram profile that is private, missing or broken', () => {
  assert.equal(mapInstagramProfile([{ ...igProfile, private: true, latestPosts: [] }], 'aruzhan.vibes').status, 'private');
  assert.equal(mapInstagramProfile([], 'nobody').status, 'not_found');
  assert.equal(mapInstagramProfile([{ url: 'https://www.instagram.com/nobody', error: 'not_found', errorDescription: 'Profile does not exist' }], 'nobody').status, 'not_found');
  // The exact answer Apify gave on 24 Nov 2026 for an account that does not exist: the username is there, with an error.
  assert.equal(
    mapInstagramProfile([{ url: 'https://www.instagram.com/cocacola_kz', username: 'cocacola_kz', error: 'not_found', errorDescription: 'Profile does not exist' }], 'cocacola_kz').status,
    'not_found',
    'a username with an error is not a profile',
  );
  assert.equal(mapInstagramProfile([{ username: 'shy', error: 'restricted', errorDescription: 'Restricted profile' }], 'shy').status, 'private');
  assert.equal(mapInstagramProfile([{ username: 'busy', error: 'rate_limited', errorDescription: 'Too many requests' }], 'busy').status, 'error');
  assert.equal(mapInstagramProfile([{ username: 'ghost' }], 'ghost').status, 'not_found', 'a bare username with no id and no followers is nobody');
  assert.equal(mapInstagramProfile([{ error: 'restricted', errorDescription: 'Empty or private data for provided input' }], 'shy').status, 'private');
  assert.equal(mapInstagramProfile([{ error: 'rate_limited', errorDescription: 'Too many requests' }], 'busy').status, 'error');
  assert.equal(mapInstagramProfile([{ username: 'someone.else', followersCount: 1 }], 'aruzhan.vibes').status, 'not_found', 'another account is not this one');
  assert.equal(mapInstagramProfile([null, 42, 'x'], 'aruzhan.vibes').status, 'not_found');
});

test('apify: Instagram post and reel', () => {
  const reelUrl = 'https://www.instagram.com/reel/DZN3mhZBQ_Q/?igsh=abc';
  const reel = mapInstagramPost(
    [
      {
        inputUrl: reelUrl,
        id: '3646',
        type: 'Video',
        productType: 'clips',
        shortCode: 'DZN3mhZBQ_Q',
        caption: 'Caravan night ✨ with @CocaCola_KZ #NewYear #coke_winter',
        hashtags: ['NewYear', 'coke_winter'],
        mentions: ['CocaCola_KZ'],
        taggedUsers: [{ username: 'dana.almaty', full_name: 'Dana' }],
        url: 'https://www.instagram.com/p/DZN3mhZBQ_Q/',
        commentsCount: 92,
        likesCount: 11481,
        timestamp: '2026-12-25T19:58:30.000Z',
        ownerUsername: 'Aruzhan.Vibes',
        ownerId: '4815162342',
        videoViewCount: 41365,
        videoPlayCount: 241820,
        displayUrl: 'https://scontent.cdninstagram.com/reel.jpg',
      },
    ],
    reelUrl,
    parseLink(reelUrl),
  );
  assert.equal(reel.status, 'ok');
  if (reel.status !== 'ok') return;
  assert.equal(reel.post.kind, 'reel');
  assert.equal(reel.post.authorHandle, 'aruzhan.vibes');
  assert.equal(reel.post.views, 241820);
  assert.deepEqual(reel.post.mentions, ['cocacola_kz', 'dana.almaty'], 'caption mentions and tagged users, lower case');
  assert.deepEqual(reel.post.hashtags, ['newyear', 'coke_winter']);
  assert.equal(reel.post.publishedAt, '2026-12-25T19:58:30.000Z');
  assert.equal(reel.post.shares, null, 'Instagram does not show shares');
  assert.equal(reel.post.externalId, 'DZN3mhZBQ_Q');

  const photoUrl = 'https://www.instagram.com/p/DPhoto/';
  const photo = mapInstagramPost([{ type: 'Image', shortCode: 'DPhoto', likesCount: 50, commentsCount: 3, timestamp: 1767000000, ownerUsername: 'x' }], photoUrl, parseLink(photoUrl));
  assert.ok(photo.status === 'ok' && photo.post.kind === 'post' && photo.post.views === null);
  assert.ok(photo.status === 'ok' && photo.post.publishedAt === new Date(1767000000 * 1000).toISOString(), 'unix seconds are read');

  assert.equal(mapInstagramPost([], photoUrl, parseLink(photoUrl)).status, 'gone');
  assert.equal(mapInstagramPost([{ url: photoUrl, error: 'not_found', errorDescription: 'Post does not exist' }], photoUrl, parseLink(photoUrl)).status, 'gone');
  assert.equal(mapInstagramPost([{ error: 'restricted', errorDescription: 'Restricted profile' }], photoUrl, parseLink(photoUrl)).status, 'gone');
  assert.equal(mapInstagramPost([{ error: 'blocked', errorDescription: 'Proxy failure' }], photoUrl, parseLink(photoUrl)).status, 'error');
});

test('apify: Instagram story from the story reader', () => {
  const url = 'https://www.instagram.com/stories/aruzhan.vibes/3790000000000000001/';
  const items = [
    { sourceUsername: 'aruzhan.vibes', type: 'story', mediaPk: '3790000000000000000', mediaType: 'photo', imageUrl: 'https://scontent/other.jpg' },
    {
      sourceUsername: 'aruzhan.vibes',
      type: 'story',
      mediaPk: '3790000000000000001',
      shortCode: 'DStory1',
      mediaType: 'video',
      imageUrl: 'https://scontent.cdninstagram.com/story.jpg',
      videoUrl: 'https://scontent.cdninstagram.com/story.mp4',
      takenAt: '2026-12-25T18:22:00.000Z',
      expiringAt: '2026-12-26T18:22:00.000Z',
      mentions: [{ username: 'cocacola_kz', fullName: 'Coca-Cola KZ', userId: '1', isVerified: true }],
      hashtags: [],
      highlightId: null,
    },
  ];
  const story = mapInstagramStory(items, url, parseLink(url));
  assert.equal(story.status, 'ok');
  if (story.status !== 'ok') return;
  assert.equal(story.post.kind, 'story');
  assert.equal(story.post.authorHandle, 'aruzhan.vibes');
  assert.equal(story.post.mediaUrl, 'https://scontent.cdninstagram.com/story.mp4', 'the video is the copy we keep');
  assert.deepEqual(story.post.mentions, ['cocacola_kz']);
  assert.equal(story.post.views, null, 'only the author sees story views');
  assert.equal(mapInstagramStory(items.slice(0, 1), url, parseLink(url)).status, 'gone', 'expired: no longer among the live stories');
});

const tiktokVideo = {
  id: '7450000000000000001',
  text: 'New Year table 🎄 @cocacola_kz #newyear',
  createTimeISO: '2026-12-28T12:00:00.000Z',
  createTime: 1798459200,
  authorMeta: { id: '6999', name: 'Aruzhan.Vibes', nickName: 'Aruzhan', verified: false, signature: 'Almaty', avatar: 'https://p16.tiktokcdn.com/a.jpg', privateAccount: false, fans: 15100, following: 300, video: 88 },
  webVideoUrl: 'https://www.tiktok.com/@aruzhan.vibes/video/7450000000000000001',
  videoMeta: { coverUrl: 'https://p16.tiktokcdn.com/c.jpg', duration: 21 },
  diggCount: 2300,
  shareCount: 140,
  playCount: 61000,
  commentCount: 77,
  hashtags: [{ id: '1', name: 'newyear' }],
  mentions: ['@cocacola_kz'],
};

test('apify: TikTok profile and video', () => {
  const profile = mapTiktokProfile([tiktokVideo, { ...tiktokVideo, id: '2', webVideoUrl: 'https://www.tiktok.com/@aruzhan.vibes/video/2', playCount: 1000 }], 'aruzhan.vibes');
  assert.equal(profile.status, 'ok');
  if (profile.status === 'ok') {
    assert.equal(profile.profile.followers, 15100);
    assert.equal(profile.profile.postsCount, 88);
    assert.equal(profile.profile.recent.length, 2);
    assert.equal(profile.profile.recent[0]!.views, 61000);
  }
  assert.equal(mapTiktokProfile([{ errorCode: 'PROFILE_PRIVATE', error: 'Profile is private' }], 'x').status, 'private');
  assert.equal(mapTiktokProfile([], 'x').status, 'not_found');

  const url = tiktokVideo.webVideoUrl;
  const video = mapTiktokPost([tiktokVideo], url, parseLink(url));
  assert.ok(video.status === 'ok');
  if (video.status !== 'ok') return;
  assert.equal(video.post.authorHandle, 'aruzhan.vibes');
  assert.deepEqual([video.post.views, video.post.likes, video.post.comments, video.post.shares], [61000, 2300, 77, 140]);
  assert.deepEqual(video.post.hashtags, ['newyear']);
  assert.deepEqual(video.post.mentions, ['cocacola_kz']);
});

test('apify: calls use the Bearer header, never put the token in the address, and survive failures', async () => {
  const seen: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  let answer: () => Response = () => Response.json([igProfile]);
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      auth: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return answer();
  }) as typeof fetch;
  const provider = createApifyProvider('secret-token-123', fakeFetch);

  const profile = await provider.fetchProfile('instagram', 'aruzhan.vibes');
  assert.equal(profile.status, 'ok');
  assert.equal(seen[0]!.auth, 'Bearer secret-token-123');
  assert.ok(!seen[0]!.url.includes('secret-token-123'));
  assert.ok(seen[0]!.url.startsWith(`https://api.apify.com/v2/acts/${ACTORS.instagramProfile}/run-sync-get-dataset-items?`));
  assert.deepEqual(seen[0]!.body, { usernames: ['aruzhan.vibes'] });

  answer = () => Response.json([]);
  await provider.fetchPost('https://www.instagram.com/reel/ABC/');
  assert.deepEqual(seen[1]!.body, { directUrls: ['https://www.instagram.com/reel/ABC/'], resultsType: 'posts', resultsLimit: 1, addParentData: false });
  await provider.fetchPost('https://www.instagram.com/stories/aruzhan.vibes/123/');
  assert.ok(seen[2]!.url.includes(ACTORS.instagramStories));
  assert.deepEqual(seen[2]!.body.usernames, ['aruzhan.vibes']);
  await provider.fetchPost('https://www.tiktok.com/@a/video/1');
  assert.deepEqual(seen[3]!.body.postURLs, ['https://www.tiktok.com/@a/video/1']);

  assert.equal((await provider.fetchPost('https://example.com/my-blog')).status, 'unsupported');
  assert.equal(seen.length, 4, 'an unsupported link costs nothing');

  answer = () => new Response('{"error":{"type":"not-enough-usage"}}', { status: 402 });
  const failed = await provider.fetchProfile('instagram', 'aruzhan.vibes');
  assert.equal(failed.status, 'error');
  assert.ok(failed.status === 'error' && !failed.message.includes('secret-token-123'));
  answer = () => {
    throw new Error('network down: secret-token-123');
  };
  const offline = await provider.fetchPost('https://www.instagram.com/p/ABC/');
  assert.ok(offline.status === 'error' && !offline.message.includes('secret'), 'a raw error message never travels on');
});

test('links: handles and publication addresses', () => {
  assert.deepEqual(parseLink('https://www.instagram.com/aruzhan.vibes/reel/ABC/'), { platform: 'instagram', kind: 'reel', author: 'aruzhan.vibes', id: 'ABC' });
  assert.deepEqual(parseLink('https://instagram.com/p/XYZ'), { platform: 'instagram', kind: 'post', author: null, id: 'XYZ' });
  assert.equal(parseLink('https://evil.com/instagram.com/p/XYZ').platform, 'other');
  assert.equal(parseLink('https://instagram.com.evil.com/p/XYZ').platform, 'other');
});


// --- Reel views: the profile reader has none, a second reader fills them in -----------------
// Shapes as Apify returned them on 24 Nov 2026 for a public account.

test('reel views: the reels reader is asked for the account and its plays are mapped', async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  let answer: () => Response = () =>
    Response.json([
      { type: 'Video', productType: 'clips', shortCode: 'Df79c9PN-Qk', url: 'https://www.instagram.com/p/Df79c9PN-Qk/', videoPlayCount: 87328, likesCount: 917, commentsCount: 85, timestamp: '2026-11-19T20:42:41.000Z', ownerUsername: 'Aruzhan.Vibes', displayUrl: 'https://cdn.example/t.jpg' },
      { type: 'Video', productType: 'clips', shortCode: 'OTHER', url: 'https://www.instagram.com/p/OTHER/', videoPlayCount: 5, ownerUsername: 'someone.else' },
      { username: 'aruzhan.vibes', error: 'no_items', errorDescription: 'Empty' },
    ]);
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return answer();
  }) as typeof fetch;
  const provider = createApifyProvider('secret-token-123', fakeFetch);

  const reels = await provider.fetchReels!('@Aruzhan.Vibes', 12);
  assert.ok(seen[0]!.url.includes(ACTORS.instagramReels));
  assert.deepEqual(seen[0]!.body, { username: ['aruzhan.vibes'], resultsLimit: 12 });
  assert.equal(reels.length, 1, 'only this account’s reels, no error items');
  assert.equal(reels[0]!.kind, 'reel');
  assert.equal(reels[0]!.views, 87328);

  // Trouble with the second reader never breaks a profile: it is simply "no numbers this time".
  answer = () => new Response('{}', { status: 402 });
  assert.deepEqual(await provider.fetchReels!('aruzhan.vibes', 12), []);
  assert.deepEqual(await provider.fetchReels!('not a handle!', 12), []);
});

test('reel views: merged into the profile’s recent posts by short code', () => {
  const post = (code: string, kind: RecentPost['kind'], path = 'p'): RecentPost => ({
    url: `https://www.instagram.com/${path}/${code}/`,
    kind,
    publishedAt: '2026-11-19T20:42:41.000Z',
    views: null,
    likes: 100,
    comments: 5,
    thumbUrl: null,
  });
  assert.equal(instagramCode('https://www.instagram.com/p/Df79c9PN-Qk/'), 'Df79c9PN-Qk');
  assert.equal(instagramCode('https://www.instagram.com/aruzhan.vibes/reel/ABC_1-x/?igsh=1'), 'ABC_1-x');
  assert.equal(instagramCode('https://www.instagram.com/stories/aruzhan.vibes/123/'), null);

  // The profile lists a reel as a plain /p/ link with no views; the reels reader knows its plays.
  const recent = [post('PHOTO', 'post'), post('REEL1', 'reel'), post('REEL2', 'unknown')];
  const reels = [
    { ...post('REEL1', 'reel', 'reel'), views: 35805, likes: 640 },
    { ...post('REEL2', 'reel'), views: 57969 },
    { ...post('OLDER', 'reel'), views: 1000 },
    { ...post('NOVIEWS', 'reel'), views: null },
  ];
  const merged = mergeReelViews(recent, reels);
  assert.deepEqual(
    merged.map((item) => [instagramCode(item.url), item.kind, item.views]),
    [['PHOTO', 'post', null], ['REEL1', 'reel', 35805], ['REEL2', 'reel', 57969], ['OLDER', 'reel', 1000]],
  );
  assert.equal(merged[1]!.likes, 100, 'the profile’s own numbers are kept');
  assert.equal(mergeReelViews(recent, []), recent, 'nothing to merge changes nothing');
});
