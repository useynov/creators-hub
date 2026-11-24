# Creators Hub v2: specification

Two workstreams build v2 in parallel on top of the `v2-foundation` branch:

- **Creator workstream** (`v2-creator`): the mini app and the data pipeline behind it.
- **Admin workstream** (`v2-admin`): a desktop admin site for the team.

This file is the contract between them. If something here is wrong or missing, say so in your report. Do not silently work around it.

## 1. Product decisions (made by the owner, do not reopen)

Creator side
1. Proof of a task is a link, for reels, posts and stories alike.
2. Review is set per task: `post_first` (default) or `draft_first`.
3. A returned submission can be fixed and resent any number of times until the deadline.
4. Three levels: Member (tasks, events, merch), Pro (cash-out), Partner (paid offers).
5. Community in v1: a closed Telegram group and a leaderboard.

Account and data (23 Nov 2026)
6. Creators must be 18 or older. The setup screen asks for the date of birth. Younger people cannot enter.
7. The creator types their Instagram handle. We pull the public profile at once and show it back: avatar, name, followers, number of posts, open or private. The creator confirms "this is me".
8. We also store bio, average reel views and engagement over the last 12 publications.
9. A private or not-found account cannot enter: the creator stays on the connect screen with instructions and "Check again".
10. A new account is `pending` until a manager confirms it in the admin. While pending, the creator is inside the Hub and can take and submit tasks, but a submission cannot be approved (so no coins) until the account is confirmed. A rejected account cannot take tasks and is asked to change the handle.
11. TikTok is optional and never blocks entry.

Link, checks, numbers
12. We read only public data. We never log in to a creator's account.
13. Every submitted link is checked automatically:
    - posted from the creator's own connected account: a mismatch BLOCKS the submission with a clear message
    - published after the task's start, carries the required mention and hashtag, is a format the task accepts, is reachable: a failure or an unknown is a FLAG for the reviewer, never a block
14. Numbers are measured four times per publication: at submission, after 24 hours, after 7 days, final after 14 days (`settings.metrics.scheduleHours`). The final measurement is the one in the report and the bonus.
15. Stories: we save a copy of the story while it is live (private to the team). 24 hours after submission the bot asks the creator for the number of views and a screenshot of the story statistics. The report marks that number "as stated by the creator".
16. Photo posts have no public view count: likes and comments only.
17. Coins are paid when the team approves the work, not at the final measurement. Only the top performer bonus waits for final numbers.
18. A publication deleted before its final measurement raises a flag for the team. Coins are not taken back automatically.

Admin
19. A website for desktop at `/admin`. Russian and English with a switch (Russian by default).
20. Three roles: Owner (everything), Manager (creators, tasks, review, orders; payouts read-only), Viewer (reports only, no personal data such as addresses, phones, payout details).
21. First version: Overview, Creators, Creator card, Invitations, Tasks, Task editor, Review, Task report with Excel export, Orders, Payouts, Team and roles.
22. Task audience: everyone, or a segment (city, Instagram followers range, level, tags), or a hand-picked list.
23. The quick review buttons in the bot stay.

Owner's comments on the creator screens (23 Nov 2026), all must be visible in the mini app
- Setup: ask the age, 18+ only.
- Home, "News from us": the Creators New Year Party invitation (it is in `content/seed.json`, with a photo, and opens Events).
- Tasks: show relevant photos, less text. Every task card and the task screen lead with the cover photo.
- No visible placeholders anywhere. Real content or nothing.
- Task screen (and the draft-first task, and the paid offer where it fits): a collapsible "Detailed brief".
- "In review": the team answers within 24 hours (`settings.reviewTime`).
- Shop: real product photos (`imageUrl` in the seed).
- Events: photos, real names, places and times (in the seed).
- Event pass: a real, scannable QR code.
- Profile: the avatar pulled from Instagram.
- Paid offer example: campaign "New Year with Coca-Cola: hero reel", fee "150,000 ₸", what we need "1 reel", post by "5 Jan 2027", answer by "15 Dec 2026".

## 2. Foundation (already in `v2-foundation`)

Read these before writing code:

| File | What it gives you |
| --- | --- |
| `server/src/db.ts` | New tables (`social_profiles`, `user_tags`, `publications`, `snapshots`, `team_members`, `admin_logins`, `admin_sessions`, `audit_log`), new columns via `ADDED_COLUMNS`, all row types. `syncContent` no longer touches tasks whose `source` is `admin` |
| `server/src/social/types.ts` | `SocialProvider`, `ProfileData`, `PostData`, `LinkChecks` |
| `server/src/audience.ts` | `Audience`, `parseAudience`, `matchesAudience` |
| `server/src/account.ts` | `profileOf`, `tagsOf`, `setTags`, `audienceSubject` (working), `refreshProfile`, `setAccountStatus` (to build, creator) |
| `server/src/pipeline.ts` | `publicationsOf`, `publicationsOfTask`, `snapshotsOf` (working), `recheckPublication`, `runDueSnapshots`, `setStoryViews` (to build, creator) |
| `server/src/media.ts` | `saveMedia`, `readMedia`, `downloadMedia`, `sniff`. Public zone is served at `/media/*`. The private zone is never served by a static route |
| `server/src/admin/routes.ts`, `server/src/admin/bot.ts` | Hooks already wired into `http.ts` and `bot.ts` (to build, admin) |
| `server/src/jobs.ts` | `startJobs(db)` already called from `index.ts` (to build, creator) |
| `admin/` | An empty React + Vite workspace, built to `admin/dist`, served under `/admin` |
| `content/seed.json`, `content/settings.json` | New content and settings |

Schema rules
- Need another column or table? Add it in `db.ts` (`ADDED_COLUMNS` or `SCHEMA`) and list it in your report. Never rename or drop.
- All times are ISO strings in UTC from `now()`. JSON columns hold valid JSON, always.

## 3. Who may edit what

To keep the merge clean, stay inside your lane.

| Area | Creator workstream | Admin workstream |
| --- | --- | --- |
| `web/**` | owns | must not touch |
| `admin/**` | must not touch | owns |
| `server/src/admin/**` | must not touch | owns |
| `server/src/social/**`, `account.ts`, `pipeline.ts`, `jobs.ts` | owns | call only |
| `server/src/service.ts`, `types.ts`, `http.ts` (mini app routes), `bot.ts`, `notify.ts` | owns | call only. Exception: none. Put admin logic in `server/src/admin/` |
| `server/src/db.ts` | append only | append only |
| `server/src/audience.ts`, `media.ts`, `config.ts`, `team.ts` | call only (append-only fixes allowed, report them) | call only (append-only fixes allowed, report them) |
| `content/seed.json` | owns | must not touch |
| `README.md`, `Dockerfile`, `.env.example`, root `package.json` | leave, report what should change | leave, report what should change |
| Tests | `server/src/*.test.ts` | `server/src/admin/*.test.ts` |

The server's test script is `tsx --test src/*.test.ts`. The admin workstream may change it to also run `src/admin/*.test.ts` (that one line in `server/package.json` is theirs).

## 4. Creator workstream

### 4.1 Data provider (`server/src/social/`)
- `apify.ts`: real data through Apify actors, token from `config.apifyToken`, sent in the `Authorization: Bearer` header, never in a URL and never logged. Check the actor names, inputs and output fields against Apify's own documentation before coding the mapping, and write what you used, with links, into `docs/DATA-PROVIDER.md` (including the cost per call if the docs state it). There is no token in this environment: the real calls cannot be run here. Make the mapping defensive (every field optional), cover it with tests that feed recorded-shape fixtures, and list in your report exactly what still needs a live test.
- `demo.ts`: deterministic sample data derived from the handle, so the whole product works without a token. Special handles for tests and demos: a handle containing `private` answers private, `missing` answers not found, `error` answers a provider error. Demo data must be marked: `source: 'demo'` in the database.
- `index.ts`: `getProvider()` returns Apify when there is a token, otherwise demo. `setProvider()` for tests.
- Calls can take a minute. No HTTP request of the mini app may wait on the provider for more than a few seconds: start the work, answer at once, let the app poll.

### 4.2 Entry: age and account
- Setup collects date of birth, Instagram handle, optional TikTok handle, city.
- Under `settings.minAge`: refuse, show a kind final screen, keep nothing but the fact that this Telegram id was refused for age (so they cannot simply retry with another date). Do not store the birth date of a refused person.
- Connect flow: type the handle, "Find my profile", progress state, then one of: found (avatar, name, @handle, followers, posts, "Open"; buttons "Yes, this is me" and "Not me, change the handle"), private (how to open the profile, "Check again", "Use another account"), not found, provider error (retry).
- A handle already connected to another Hub account is refused.
- On "this is me": store the profile in `social_profiles`, download the avatar into the public media zone and set `users.avatar_url`, compute `avg_reel_views` and `engagement_rate` from the recent publications, set `account_status = 'pending'`, finish onboarding, and tell the team in the bot that a new account waits for confirmation.
- `setAccountStatus` and `refreshProfile` in `account.ts` as documented there.
- Changing the Instagram handle later (Profile, My details) runs the same connect flow and sets the account back to `pending`.
- Profile refresh: weekly (`settings.metrics.profileRefreshDays`) and when a work is submitted, in the background.

### 4.3 Tasks
- Visible to a creator when: `active = 1`, `status = 'active'`, not past the deadline (unless they already have an entry), and `matchesAudience` is true for them. Same rule for opening a task by link and for joining. `max_participants` closes joining when reached.
- `announceTask` messages only creators in the task's audience.
- Cover photo on every task card and on the task screen. Detailed brief (`tasks.brief`, plain text with blank-line paragraphs and short heading lines) in a collapsible block.
- `TaskView` gains what the app needs (`brief`, `formats`, `requiredMention`, `requiredHashtag`, `startsAt`, `bonusCoins`, and per-publication data for the entry).
- A rejected account sees tasks locked with the reason. A pending account sees a small "account being confirmed" note and can work.

### 4.4 Submission, checks, measurements
- On submit, each link becomes a `publications` row. `entries.links` stays in sync for old code paths.
- The check and the first measurement run in the background. The submit screen shows "Checking your link" and then the result. Own-account mismatch: the link is refused, nothing goes to the team, the creator sees whose post it is and which account is connected. Up to `tasks.max_publications` links per entry.
- If the provider cannot read the link at all (error, unsupported site), accept it with `unknown` checks: the reviewer decides.
- The team's bot message for a submission lists the check results in plain words.
- `snapshots` rows are created at submission for the three follow-ups. `runDueSnapshots` takes what is due, stores numbers on the snapshot and on the publication, keeps `entries.views` equal to the sum of its publications' current views, and marks the publication `final` after the last one. A publication that has disappeared: mark it `removed` (`status`, not `removed_at`), skip its remaining snapshots, tell the team once.
- Stories: at submission download the media into the private zone (`media_path`). After 24 hours the bot asks for the views with one button that opens a screen in the app: a number and a screenshot upload. Screenshots go to the private zone. `setStoryViews` as documented. Remind once more after another 24 hours, then stop.
- `approveEntry` refuses while the creator's account is not confirmed, with a message the reviewer understands.
- `jobs.ts`: one timer, every job idempotent and never throwing out of a tick. No job may run in tests unless a test calls it.

### 4.5 Screens and content
- All owner comments from section 1. No bracketed placeholder may be visible anywhere in the mini app.
- Photos: tasks, events, shop, news. The seed holds remote addresses. Add a start-up step that copies each remote seed photo into the public media zone once and points the row at the local copy (keep the remote address if the copy fails). The app must look right with a missing photo too (a calm fallback, never a broken image).
- Avatar in Profile and on Home. "In review" promises `settings.reviewTime`.
- Development preview (`DEV_USER_ID`, never in production): seed a believable demo state for that user so every screen can be looked at in a browser: connected and confirmed account with an avatar, entries in every status, publications with snapshots, a story waiting for its views, coins, an order, an RSVP, and the paid offer example from section 1 (set a level override so the offer is visible).

### 4.6 Tests (`server/src/*.test.ts`)
Keep every existing test green (adapt them where the rules changed) and add tests for: the age gate, each connect outcome, handle uniqueness, account status effects on approval, audience visibility and joining, each automatic check including the block, the four measurements and totals, a removed publication, story views with and without a screenshot, seed photo localisation, and the Apify mapping from fixtures.

## 5. Admin workstream

### 5.1 Login and security (highest priority, get this right)
- Login by a one-time link from the bot. A team member sends `/admin` to the bot in a private chat. The bot answers with a link `WEBAPP_URL/admin/login?token=...`, valid for 5 minutes, single use. Opening it sets the session cookie and redirects to `/admin`. The login page explains this and links to the bot.
- Who is "team": the owners in `ADMIN_IDS` (always Owner, cannot be removed or demoted) and the rows of `team_members`. Demo mode (`team.ts`) must NOT open the admin site.
- Tokens: 32 random bytes, only their SHA-256 stored (`admin_logins`, `admin_sessions`). Session cookie: `HttpOnly`, `Secure` (except on localhost), `SameSite=Strict`, `Path=/`, 7 days, rolling. Logout deletes the session. Changing someone's role or removing them ends their sessions.
- Every `/api/admin/*` route checks the session and the role on the server. The UI hiding a button is not access control. Mutating requests must also carry a header the browser will not add cross-site (`X-Requested-With: creators-hub-admin`) and must have a JSON or multipart body: reject otherwise.
- Viewer never receives addresses, phones, payout details, birth dates or private media, not even in the JSON.
- Rate-limit `/admin/login` attempts per IP in memory. Log every mutation to `audit_log` (who, what, target, short detail, no secrets, no personal data).
- Uploads (task covers): images only, by content (`saveMedia`), size cap, public zone.
- Private media (story copies, statistics screenshots) are served only through an admin route that checks the role (Owner, Manager).
- Development preview: when `DEV_USER_ID` is set and not in production, `/api/admin/auth/dev` logs in as an Owner so the site can be looked at locally. It must not exist in production.

### 5.2 Screens (follow the approved designs)
The approved screen designs are handed to you with your instructions (they live outside the repository). Layout: dark sidebar with the sections and counters, RU and EN switch, the signed-in person and role. Ground `#F6F2EF`, cards white, ink `#1C1414`, accent red `#DC0A17` (white text on `#DC0A17` only at 14px bold or larger), font Inter with a system fallback (bundle it with `@fontsource-variable/inter`, do not load fonts from another site).

1. **Overview**: what waits for action (accounts to confirm, works to review, new orders, payout requests), the month in numbers, active tasks with their funnel, alerts (removed publications, stories without numbers, accounts that went private).
2. **Creators**: table with avatar, name, handle, followers, average reel views, engagement, city, level, rating, tags, account status. Search, filters (status, city, followers range, level, tag), sorting, paging on the server.
3. **Creator card**: confirm or reject the account (with a note), pulled profile data with "Refresh now" (`refreshProfile`), recent publications, tags editor (`setTags`), level override (Owner only), history of entries with numbers, wallet, details (hidden from Viewer).
4. **Invitations**: invite by a list of Telegram usernames or ids with optional tags, the shared link (show, copy, replace, turn off, using the existing service functions), recent invitations with status.
5. **Tasks**: tabs Active, Drafts, Closed. Funnel (joined, submitted, approved), views, links to the report and the editor.
6. **Task editor**: title, summary, detailed brief, steps, place and date, cover upload, accepted formats, required mention and hashtag, review mode, reward, max publications, bonus, participant limit, start and deadline, audience (all, segment, list with a creator picker). Live "N creators will see this" and the budget ceiling. Save as draft, publish, publish and announce (`announceTask`), close. Editing a seed task sets `source = 'admin'`. New ids are slugs from the title, unique.
7. **Review**: three queues: works, drafts, story numbers. A work shows the publications with their automatic checks in plain words, numbers so far, the creator's usual level (average reel views), the creator's note, the story copy or thumbnail, and a link to the post. Approve with a score (`approveEntry`), return with a comment (`requestChanges`), approve a draft (`approveDraft`). If the account is not confirmed, say so and link to the card. Story numbers: see the stated number and the screenshot, correct it (`setStoryViews`).
8. **Task report**: totals (publications by format, creators, views with the share stated by creators, likes and comments, coins paid, cost per 1000 views when the coin rate is set), one row per publication with the four measurements, likes, comments, source of the number and status, filters by format and status, sorting. **Excel export** of exactly what the table shows, in the interface language, as a real `.xlsx` (use `exceljs`). Viewer can open and export reports.
9. **Orders**: tabs by status (new, packed, shipped, delivered), move an order forward, the creator gets a bot message on each step. CSV or Excel list for the courier.
10. **Payouts**: requests with coins, amount at the rate, details. Owner marks paid or rejects with a note. Rejecting returns the coins through the ledger and tells the creator. Manager sees the list read-only. Viewer has no access.
11. **Team and roles** (Owner only): members, add by Telegram id or username (must have started the bot), change role, remove. The rights table.

### 5.3 API
`/api/admin/*`, JSON, consistent errors `{ error, message }` like the mini app API. Types in `server/src/admin/types.ts`, imported by `admin/` as types only. Lists paginate on the server. No endpoint returns more than it needs.

### 5.4 Interface language
Every visible string in both Russian and English, from one dictionary, chosen language stored in the browser. Dates and numbers formatted for the language. No machine-sounding Russian.

### 5.5 Tests (`server/src/admin/*.test.ts`)
Login link (valid, expired, reused, wrong person), session and logout, the role matrix on every route group (Owner, Manager, Viewer, nobody), the CSRF header rule, Viewer never receiving personal data, demo mode not opening the admin, task create, edit, publish and audience count, review actions, report totals and the Excel file opening with the right rows, order steps, payout paid and rejected with coins returned, team changes ending sessions.

The creator workstream's functions that throw "not built yet" are not available to you while you build. Seed the tables directly in your tests, and write the code that calls those functions so that it works once they are real.

## 6. For both

- Node 22, TypeScript strict, the existing style: small functions, plain comments that explain why, no dead code, no `any` without a reason.
- No new dependency unless it is clearly needed. Run `npm audit` after adding one.
- Never weaken an existing check. Never log a token, a cookie or personal data.
- User input is hostile: lengths, types, ranges on every field, prepared statements only, HTML escaped in bot messages (`esc`).
- Done means: `npm run typecheck`, `npm test` and `npm run build` all pass from the repository root, and you have looked at your screens in a real browser (see your instructions for how).
- Commit in small steps with clear messages. Do not push, do not open pull requests.
