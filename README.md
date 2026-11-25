# Creators Hub

A Telegram bot and mini app for an invite-only creator community: tasks for coins, a merch shop, events with QR passes, levels and a leaderboard. The team runs it from an admin site and from the bot.

One Node process runs everything: the bot, the API, the mini app and the admin site.

```
server/   Bot (grammY), API (Hono), SQLite database, the admin API (server/src/admin)
web/      Mini app for creators (React + Vite)
admin/    Admin site for the team (React + Vite), served at /admin
content/  Starting tasks, events, shop items, news and program settings, as JSON
docs/     V2-SPEC.md (how v2 is put together), DATA-PROVIDER.md (where the public numbers come from)
```

This is **version 2**. What changed, how to see which version is running and how to go back to version 1 are in [CHANGELOG.md](CHANGELOG.md).

## How it works

**Creators** press Start in the bot. If they are on the invite list, or opened the team's invite link, they get the welcome and one button that opens the mini app. On the first visit they confirm they are 18 or older, type their Instagram handle and see their own profile pulled from public data ("Is this you?"). A private or missing account is not let in. Everything else happens in the app: take a task, send the link, follow the review, spend coins, RSVP to events.

**The team** has two places to work. The **admin site** at `/admin` (a desktop website, Russian and English) covers creators, invitations, tasks with audiences, review, reports with an Excel export, merch orders, payouts and the team's roles. The **bot** keeps the quick actions: it posts every submission, order and question to the team (one group chat, or each team member in private) with buttons to approve or ask for changes.

**Signing in to the admin site.** Send `/admin` to the bot in a private chat. It answers with a one-time link that works for five minutes. There are no passwords. The session lasts a week while it is used.

| Role | What they can do |
| --- | --- |
| Owner | Everything, including payouts, levels by hand and the team itself. The `ADMIN_IDS` are always Owners |
| Manager | Creators, invitations, tasks, review, orders and reports. Sees payouts but cannot mark them. Works in the bot too, except coins by hand, levels by hand and paid offers |
| Viewer | Reports only, without addresses, phones, birth dates or payout details. Nothing in the bot |

**What the Hub reads from Instagram and TikTok.** Only public data, through Apify (see `docs/DATA-PROVIDER.md`): the profile at sign-up (avatar, followers, average reel views and engagement over the last 12 publications), and each submitted publication four times (at submission, after 24 hours, 7 days and 14 days). A link from someone else's account is refused; other problems (published before the task started, no brand mention) reach the reviewer as a flag. A story is copied while it is live, and 24 hours later the bot asks the creator for its views and a screenshot; reports mark such numbers "as stated by the creator". Without `APIFY_TOKEN` the app answers with clearly marked sample data, so a demo still works.

**Account confirmation.** A new creator's account is "pending" until an Owner or Manager confirms it is really theirs (on the creator's card, or with the buttons under the bot's message). A pending creator can take tasks; their work can be approved and paid only after the account is confirmed.

| What | Where |
| --- | --- |
| Invite creators | `/invite @username` in the bot |
| Invite by link | `/invitelink` in the bot gives one link. Whoever opens it and presses Start goes on the invite list. `/invitelink new` replaces it, `/invitelink off` turns it off |
| Let testers try both sides | `/demo on` gives everyone on the invite list the team's rights and the team's messages, so each tester reviews their own submissions. Owners only, and never with real creators in the Hub. `/demo off` ends it |
| Stop the team's messages | `/quiet on` stops them coming to you in private, `/quiet off` brings them back |
| Review a submission | Buttons under the bot's message: Approve with a score of 3, 4 or 5, or Needs changes and then reply with the comment |
| Review a draft | Same, for tasks with draft approval. A creator can upload the video straight to the bot |
| Answer a creator | Reply to their message in the team chat |
| Check in at an event | Scan the creator's QR pass with a phone camera. It opens the bot and confirms |
| Confirm or reject an account | Buttons under "New account to confirm", or `/confirm @username` and `/reject @username reason`. Also on the creator's card in the admin site |
| Lift an age refusal after a typo | `/allowage ID`, owners only |
| Walk the creator's path again from the first screen | `/startover` in a private chat with the bot, owners only. It removes your own creator account (tasks joined, publications, coins, orders, RSVPs, Instagram, details) after you confirm with `/startover yes`; your team role and everything else stay. Then press `/start` |
| Look at the Hub with sample creators | `/sampledata on` loads 20 made-up creators with work and reports, `/sampledata off` removes them. Owners only. Remove before real creators join |
| Add or edit tasks | The admin site, Tasks. Tasks from `content/seed.json` are a starting set: once edited on the site, the file no longer overwrites them |
| Add or edit shop items and their photos | The admin site, Shop. Items from `content/seed.json` only fill an empty shop: once edited on the site, the file no longer overwrites them |
| Add or edit events, news | Edit `content/seed.json` and redeploy |

Send `/help` to the bot as an admin for the full command list.

## What you need from Telegram

1. **A bot token.** Open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and a username. BotFather answers with a token. Keep it secret.
2. **Your Telegram user ID** (and the IDs of anyone else on the team). Send any message to [@userinfobot](https://t.me/userinfobot), or send `/id` to your own bot once it runs.
3. Optional: **a team group**. Create a group, add the bot, send `/id` there and use that number as `ADMIN_CHAT_ID`.
4. Optional: **the invite link** to the closed community group, and a **welcome video**.

The mini app also needs a public **https address**, which you get from wherever you host this service.

## Configuration

Copy `.env.example` to `.env` (local) or set the same variables on your host.

| Variable | Required | What it is |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Token from BotFather |
| `WEBAPP_URL` | yes | Public https address of this service, no trailing slash |
| `ADMIN_IDS` | yes | Telegram user IDs of the owners, comma-separated. More people and their roles are added on the admin site, Team |
| `ADMIN_CHAT_ID` | no | Team group ID. Without it the bot writes to each owner and manager in private |
| `APIFY_TOKEN` | no | Apify API token for reading public Instagram and TikTok data. Without it the app shows marked sample data |
| `MEDIA_DIR` | no | Where covers, avatars, story copies and screenshots are kept. Default: a `media` folder next to the database, on the same persistent disk |
| `COMMUNITY_CHAT_URL` | no | Invite link to the members' group |
| `WELCOME_VIDEO` | no | Telegram `file_id` or a public mp4 link |
| `DATABASE_PATH` | no | SQLite file, default `./data/hub.db`. Put it on a persistent disk |
| `PORT` | no | Default `3000` |

Program rules live in `content/settings.json`: brand name, time zone, the minimum age, level thresholds, how the rating is counted, cash-out terms, the top performer bonus, coins for event check-in, when publications are measured. Values set to `null` are shown in the app as "To be announced" or left out.

## Run locally

Needs Node 22 or newer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

To look at the mini app in a normal browser without Telegram, set `DEV_USER_ID=1` in `.env` (ignored in production) and open `http://localhost:3000`. The admin site is then at `http://localhost:3000/admin` with a development sign-in and sample data. For live reload while developing, run `npm run dev` and open `http://localhost:5173` (mini app) or `http://localhost:5174/admin/` (admin site).

```bash
npm test
```

## Deploy

Pushing to `main` deploys. The workflow in `.github/workflows/deploy.yml` runs the tests, builds the Docker image, copies it to your server over SSH and starts it with Caddy in front for https (`deploy/compose.yaml`).

Set these once in the repository: Settings, Secrets and variables, Actions, New repository secret.

| Secret | Required | What it is |
| --- | --- | --- |
| `VPS_HOST` | yes | The server's IP address |
| `VPS_PASSWORD` or `VPS_SSH_KEY` | yes | The server password, or a private SSH key that can log in |
| `BOT_TOKEN` | yes | Token from BotFather |
| `ADMIN_IDS` | yes | Telegram user IDs of the team, comma-separated |
| `VPS_USER` | no | Login name, default `root` |
| `VPS_PORT` | no | SSH port, default `22` |
| `DOMAIN` | no | A domain or subdomain whose A record points at the server, for example `hub.example.com`. Without it the app gets a free `<ip>.sslip.io` address |
| `ADMIN_CHAT_ID`, `COMMUNITY_CHAT_URL`, `WELCOME_VIDEO`, `APIFY_TOKEN` | no | See Configuration |

The server needs ports 80 and 443 free and reachable. Docker is installed on the first deploy if it is missing. The database and the media folder live in the `hub-data` Docker volume and survive redeploys.

**Updating from v1.** The database is upgraded in place on the first start: nothing is deleted, coins and history stay. Members who joined before v2 are asked once to confirm their age and their Instagram profile, and their accounts wait for the team's confirmation like new ones. Before real creators join, turn demo mode off (`/demo off`) and decide whether the shared invite link stays on (`/invitelink off`).

To start a deploy by hand: Actions, Deploy, Run workflow. Until the required secrets exist the workflow only runs the tests and says which secrets are missing.

Run a single instance. The bot uses long polling, so two copies would fight over updates. On start the bot sets its own menu button ("Open app") and command list.

## Content

`content/seed.json` is the source of truth for events and news, and a starting set for tasks and shop items. On every start rows are added or updated by `id`; a task or a shop item that was edited on the admin site is left alone. Anything removed from the file is hidden, never deleted, so a creator's history stays intact.

A task:

```json
{
  "id": "caravan-shoot",
  "title": "Shoot the New Year caravan",
  "reward": 5,
  "format": "Photo, reel or story",
  "date": "2026-12-25",
  "place": "Dostyk, Almaty",
  "deadline": "2026-12-25T23:59:00+05:00",
  "reviewMode": "post_first",
  "steps": ["Come to the caravan.", "Shoot it your way and post it.", "Tag us in the post, then send us the link."]
}
```

`reviewMode` is `post_first` (post, then the team checks) or `draft_first` (the draft is approved before posting). Optional fields: `summary`, `brief` (the detailed brief the creator can unfold), `coverUrl`, `formats`, `requiredMention`, `requiredHashtag`, `startsAt`, `viewsBonus`. Photos given as remote addresses are copied to the server on start and made light for phones. Shop items take `imageUrl` and `needsSize`. An event without a `date` shows as "details soon" with a Remind me button; set `monthHint` (for example `"JAN"`) for its badge.

### Brand assets

The photos, the TCCC Unity font and the Coca-Cola logo are brand material, so they are **not in this repository**: `content/brand/` is git-ignored. The server serves that folder at `/brand/<name>`.

**Photos.** Point the script at the folder with the four source photos (`red-studio.png`, `dusk-friends.png`, `fizz-macro.png`, `portrait-studio.png`):

```bash
node scripts/brand-photos.mjs "/path/to/assets/photography"
```

It writes six small `.webp` files (welcome, three task covers, the paid offer, the news).

**Font and logo.** Point the second script at the folder with the `TCCC-Unity*.ttf` files and at a Coca-Cola logo PNG with a transparent background:

```bash
pip install fonttools brotli potracer pillow numpy
python3 scripts/brand-fonts-logo.py "/path/to/TCCC_Unity_Font_Family" "/path/to/coca-cola-logo.png" content/brand
```

It writes five `.woff2` files and `logo-red.svg`, `logo-white.svg`.

Copy `content/brand/` to the server, next to the code, before building the image. If the folder or a file is missing nothing breaks: photo blocks turn flat, the text is set in Onest, and the name is set in type instead of the logo.

TCCC Unity has Latin letters only. Cyrillic and the tenge sign are shown in Onest.

To use a different photo for a task, set its `coverUrl` in `content/seed.json` (a `/brand/...` path or any remote address), or upload a cover on the admin site.

## How the numbers work

- **Coins** are a ledger: approved tasks add, orders and cash-outs subtract. The balance is the sum.
- **Rating** = publications × `perPublication` + team scores × `perScorePoint` + views ÷ `viewsPerPoint`. The team gives the score when approving. Views are measured automatically (reels, TikTok), stated by the creator and checked by the team (stories), or set by hand with `/views`.
- **Reports** show each publication's four measurements and the totals of a task. A publication that disappears before its final measurement is flagged "removed"; coins are not taken back automatically.
- **Level** follows the rating against the thresholds in `settings.json`. `/level` overrides it by hand.
- **Leaderboard** ranks by views on approved Hub posts, this month or all time.
