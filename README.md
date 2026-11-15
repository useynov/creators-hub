# Creators Hub

A Telegram bot and mini app for an invite-only creator community: tasks for coins, a merch shop, events with QR passes, levels and a leaderboard.

One Node process runs everything: the bot, the API and the mini app.

```
server/   Bot (grammY), API (Hono), SQLite database
web/      Mini app (React + Vite)
content/  Tasks, events, shop items, news and program settings, as JSON
```

## How it works

**Creators** press Start in the bot. If they are on the invite list they get the welcome and one button that opens the mini app. Everything else happens in the app: take a task, send the link, follow the review, spend coins, RSVP to events.

**The team** works in Telegram too. The bot posts every submission, order and question to the team (one group chat, or each admin in private) with buttons to approve or ask for changes. There is no separate admin site.

| What | Where |
| --- | --- |
| Invite creators | `/invite @username` in the bot |
| Review a submission | Buttons under the bot's message: Approve with a score of 3, 4 or 5, or Needs changes and then reply with the comment |
| Review a draft | Same, for tasks with draft approval. A creator can upload the video straight to the bot |
| Answer a creator | Reply to their message in the team chat |
| Check in at an event | Scan the creator's QR pass with a phone camera. It opens the bot and confirms |
| Add or edit tasks, events, shop, news | Edit `content/seed.json` and redeploy, then `/announce task-id` |

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
| `ADMIN_IDS` | yes | Telegram user IDs of the team, comma-separated |
| `ADMIN_CHAT_ID` | no | Team group ID. Without it the bot writes to each admin in private |
| `COMMUNITY_CHAT_URL` | no | Invite link to the members' group |
| `WELCOME_VIDEO` | no | Telegram `file_id` or a public mp4 link |
| `DATABASE_PATH` | no | SQLite file, default `./data/hub.db`. Put it on a persistent disk |
| `PORT` | no | Default `3000` |

Program rules live in `content/settings.json`: brand name, time zone, level thresholds, how the rating is counted, cash-out terms, the top performer bonus, coins for event check-in. Values set to `null` are shown in the app as "To be announced" or left out.

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

To look at the mini app in a normal browser without Telegram, set `DEV_USER_ID=1` in `.env` (ignored in production) and open `http://localhost:3000`. For live reload while developing, run `npm run dev` and open `http://localhost:5173`.

```bash
npm test
```

## Deploy

Any host that runs a Docker container with a persistent disk works (Railway, Render, Fly.io, a VPS).

1. Build from the `Dockerfile`.
2. Mount a persistent disk at `/data`. The database lives there.
3. Set the environment variables above. `WEBAPP_URL` is the https address the host gives you.
4. Run a single instance. The bot uses long polling, so two copies would fight over updates.

On start the bot sets its own menu button ("Open app") and command list. Nothing to configure in BotFather beyond creating the bot.

## Content

`content/seed.json` is the source of truth for tasks, events, shop items and news. On every start rows are added or updated by `id`. Anything removed from the file is hidden, never deleted, so a creator's history stays intact.

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

`reviewMode` is `post_first` (post, then the team checks) or `draft_first` (the draft is approved before posting). Optional fields: `summary`, `coverUrl`, `viewsBonus`. Shop items take `imageUrl` and `needsSize`. An event without a `date` shows as "details soon" with a Remind me button; set `monthHint` (for example `"JAN"`) for its badge.

## How the numbers work

- **Coins** are a ledger: approved tasks add, orders and cash-outs subtract. The balance is the sum.
- **Rating** = publications × `perPublication` + team scores × `perScorePoint` + views ÷ `viewsPerPoint`. The team gives the score when approving, and sets views with `/views`.
- **Level** follows the rating against the thresholds in `settings.json`. `/level` overrides it by hand.
- **Leaderboard** ranks by views on approved Hub posts, this month or all time.
