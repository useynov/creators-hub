# Public data provider

The Hub reads only what any visitor of a profile can see. It never logs in to a creator's account and never asks for their password or a session.

Two providers implement `SocialProvider` (`server/src/social/types.ts`):

| Provider | When | What it gives |
| --- | --- | --- |
| `apify` (`server/src/social/apify.ts`) | `APIFY_TOKEN` is set | Real public data through Apify actors |
| `demo` (`server/src/social/demo.ts`) | No token | Sample data derived from the handle or link. Rows written from it carry `source = 'demo'` (`social_profiles.source`, `publications.data_source`), and the team's messages say "Sample data" |

`getProvider()` in `server/src/social/index.ts` picks one. Tests use `setProvider()`.

## How we call Apify

One synchronous call per lookup:

```
POST https://api.apify.com/v2/acts/<owner>~<actor>/run-sync-get-dataset-items?timeout=240&format=json
Authorization: Bearer <APIFY_TOKEN>
Content-Type: application/json

<actor input as JSON>
```

- The token goes in the `Authorization` header only, as Apify recommends over the `?token=` parameter, so it never lands in a URL or a log. Error messages carry the HTTP status and the actor name, never the token or the input. ([Apify API: authentication](https://docs.apify.com/api/v2))
- The endpoint answers with the dataset items as a JSON array, or `408` when the run takes longer than 300 seconds. We ask for 240 seconds and abort the HTTP call at 270. ([Run Actor synchronously and get dataset items](https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post))
- Calls take up to a minute or more. No request of the mini app waits on them: lookups and link checks run in the background (`server/src/background.ts`) and the app polls. The pipeline gives each call at most 200 seconds before treating it as an error.
- Every field of every item is read defensively: unknown types become `null`, Instagram's `-1` for hidden likes becomes `null`, an item carrying `error` / `errorDescription` / `errorCode` is read as "not found", "private" or "error" from its wording.

## Actors

| Use | Actor | Input we send | Docs |
| --- | --- | --- | --- |
| Instagram profile (connect, weekly refresh) | `apify/instagram-profile-scraper` | `{ "usernames": ["<handle>"] }` | [page](https://apify.com/apify/instagram-profile-scraper), [input](https://apify.com/apify/instagram-profile-scraper/input-schema) |
| Instagram post or reel link | `apify/instagram-scraper` | `{ "directUrls": ["<link>"], "resultsType": "posts", "resultsLimit": 1, "addParentData": false }` | [page](https://apify.com/apify/instagram-scraper), [input](https://apify.com/apify/instagram-scraper/input-schema) |
| Instagram story link | `memo23/instagram-stories-highlights-scraper` | `{ "usernames": ["<author>"], "dataToScrape": "stories", "maxStoriesPerUser": 100 }` | [page](https://apify.com/memo23/instagram-stories-highlights-scraper) |
| TikTok profile (optional handle) | `clockworks/tiktok-scraper` | `{ "profiles": ["<handle>"], "resultsPerPage": 12, "profileScrapeSections": ["videos"] }` | [page](https://apify.com/clockworks/tiktok-scraper), [input](https://apify.com/clockworks/tiktok-scraper/input-schema) |
| TikTok video link | `clockworks/tiktok-scraper` | `{ "postURLs": ["<link>"], "resultsPerPage": 1 }` | same |

Why a third-party actor for stories: Apify's own Instagram actors deprecated `"resultsType": "stories"` on 26 Nov 2025 ([changelog](https://apify.com/apify/instagram-scraper/changelog)). Of the story actors we looked at, `memo23/instagram-stories-highlights-scraper` states that it needs no cookies, password or session; others (for example `automation-lab/instagram-stories-scraper`) require a logged-in `sessionid`, which we do not use. Its Free plan hides `imageUrl`, `videoUrl` and `mentions` after the first 3 items of a run, so run it on a paid Apify plan.

## Fields we read

### Instagram profile (`mapInstagramProfile`)

| Our field | Actor field |
| --- | --- |
| handle match | `username` (case-insensitive; an item for another username is ignored) |
| `externalId` | `id` |
| `fullName`, `bio` | `fullName`, `biography` |
| `avatarUrl` | `profilePicUrlHD`, else `profilePicUrl` (copied into `media/public/avatars`, remote ones expire) |
| `followers`, `following`, `postsCount` | `followersCount`, `followsCount`, `postsCount` |
| private | `private: true` |
| `isVerified` | `verified` |
| `recent[]` | `latestPosts[]`: `url` (or built from `shortCode`), `type` / `productType` (`clips` or `Video` = reel, `Image` / `Sidecar` = post), `timestamp`, `likesCount`, `commentsCount`, views = `videoPlayCount`, else `videoViewCount` (reels only), `displayUrl` |

Not found: an empty result or an error item whose text says not found or does not exist. Private: `private: true`, or an error item that says private or restricted ("Empty or private data for provided input").

Averages (`profileAverages` in `account.ts`): over the latest `settings.metrics.profileSample` (12) publications, `avg_reel_views` = mean views of reels, `engagement_rate` = mean of (likes + comments) / followers, in percent with one decimal.

### Instagram post or reel (`mapInstagramPost`)

`ownerUsername` (author, for the own-account check), `timestamp` (published after the task start), `caption`, `mentions` and `taggedUsers[].username` (mention check), `hashtags` (hashtag check), `type` / `productType` (format check), `likesCount`, `commentsCount`, views = `videoPlayCount` else `videoViewCount` for reels only (photo posts have no public view count), `displayUrl` (thumbnail, copied into `media/public/thumbs`), `shortCode`. Instagram does not show shares: `shares` is always null. An empty result or a "not found" / "restricted" error item means the post is gone.

### Instagram story (`mapInstagramStory`)

The story link is `instagram.com/stories/<author>/<id>/`. We list the author's live stories and pick the item whose `mediaPk` equals `<id>`. Read: `sourceUsername` (author), `takenAt`, `mentions[].username` (mention stickers), `hashtags`, `videoUrl` else `imageUrl` (the copy we keep in `media/private/stories`), `imageUrl` (thumbnail). Views are never public: the creator sends them after 24 hours. Not among the live stories means expired or deleted.

### TikTok (`mapTiktokProfile`, `mapTiktokPost`)

Profile: one item per video, each with `authorMeta` (`name`, `nickName`, `signature`, `avatar`, `fans`, `following`, `video`, `verified`, `privateAccount`, `id`). Video: `authorMeta.name` (author), `createTimeISO` / `createTime`, `text` (caption), `mentions`, `hashtags[].name`, `playCount`, `diggCount`, `commentCount`, `shareCount`, `webVideoUrl`, `videoMeta.coverUrl`. Error items carry `errorCode` such as `PROFILE_PRIVATE`.

## What one call costs

Prices are per result, as the actor pages state them (Nov 2026). They change: check the pricing tab before budgeting.

| Actor | Price stated | Per call here |
| --- | --- | --- |
| `apify/instagram-profile-scraper` | from $1.60 per 1,000 profiles; $2.60 per 1,000 on the Free plan, $2.30 on Starter | about $0.0026 per connect or refresh |
| `apify/instagram-scraper` | $2.70 per 1,000 results (Free), $2.30 (Starter), $1.90 (Scale), $1.50 (Business) | about $0.0023 to $0.0027 per measurement |
| `memo23/instagram-stories-highlights-scraper` | $0.010 per account scraped (Free) down to $0.007; live stories carry no extra charge; private or missing accounts are not charged | about $0.01 per story link (read once, at submission) |
| `clockworks/tiktok-scraper` | from $1.70 per 1,000 results | about $0.0017 per video, about $0.02 per profile (12 videos) |

A reel or post costs four measurements (submission, 24 hours, 7 days, 14 days): about one cent. A story is read once. A failed measurement is retried at most twice, an hour apart. Each creator gets at most 20 profile lookups a day, and a submission refreshes the profile at most once an hour.

## Still to test with a live token

The mapping is covered by fixture tests (`server/src/apify.test.ts`) built from the documented field names. Before relying on it, run each actor once with a real token and compare:

1. `apify/instagram-profile-scraper`: an open profile, a private profile, a handle that does not exist. Confirm how "not found" and "private" come back (an error item or an empty list) and that `latestPosts` holds about 12 items with `videoPlayCount`.
2. `apify/instagram-scraper` with `resultsType: "posts"` on a `/reel/` link and a `/p/` link (the input docs suggest `/reel/` links may want `resultsType: "reels"`), and on a deleted post. Confirm `ownerUsername`, `mentions`, `taggedUsers` and whether `videoPlayCount` is present.
3. `memo23/instagram-stories-highlights-scraper` on a live story: confirm that `mediaPk` matches the id in the story link the Instagram app copies, and that `mentions` lists mention stickers.
4. `clockworks/tiktok-scraper` with `postURLs` (including a `vm.tiktok.com` short link) and with `profiles` for a private and a missing account: confirm the `errorCode` values.
5. Timing: how long each synchronous call takes, against our 200-second wait.
6. Avatar and thumbnail downloads from `scontent.cdninstagram.com` and `p16.tiktokcdn.com` work from the server (no hotlink refusal).
