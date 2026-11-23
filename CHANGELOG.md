# Changelog

## 2.0.0 (November 2026)

The second version of Creators Hub. Version 1 is kept as the tag `v1.0.0`.

**For creators (mini app)**
- Age check at sign-up: date of birth, 18 or older.
- Instagram profile pulled from public data at sign-up ("Is this you?"), with the avatar. Private or missing accounts are not let in.
- Photos on tasks, events, shop items and news. A "Detailed brief" that unfolds on tasks and paid offers.
- Every submitted link is checked automatically (own account, published after the start, mention, hashtag, format) and measured four times: at submission, after 24 hours, 7 days and 14 days.
- Stories: a copy is saved while the story is live, and the bot asks for the number of views a day later.
- A QR code on the event pass.

**For the team**
- An admin site at `/admin`, in Russian and English: creators, invitations, tasks with audiences, review, reports with an Excel export, merch orders, payouts, team roles (Owner, Manager, Viewer). Sign-in with a one-time link from the bot (`/admin`).
- An account is confirmed by the team before a creator's work can be paid.
- New bot commands: `/admin`, `/confirm`, `/reject`, `/allowage`.

**New settings**
- `APIFY_TOKEN` (optional): reads the public Instagram and TikTok data. Without it the app shows marked sample data.
- `MEDIA_DIR` (optional): where pictures and story copies are kept. By default next to the database.

**The database** is upgraded in place on the first start. Tables and columns are only added, nothing is removed or rewritten, so coins and history stay. Members from version 1 are asked once to confirm their age and their Instagram profile.

### Which version is running

Open `https://<your address>/version`. Version 2 answers `{"name":"creators-hub","version":"2.0.0"}`. Version 1 does not answer with a version there.

### Going back to version 1

Version 1 is the tag `v1.0.0` (the last commit of `main` before version 2).

1. **Before the first start of version 2, copy the data.** On the server:
   ```bash
   docker volume ls | grep hub-data
   ```
   ```bash
   docker run --rm -v creators-hub_hub-data:/data -v "$PWD":/backup alpine tar czf /backup/hub-data-before-v2.tgz -C /data .
   ```
   Use the volume name the first command prints if it differs from `creators-hub_hub-data`.
2. **To return the code,** revert the merge of version 2 on GitHub (open the merged pull request, press Revert, merge the new pull request), or build and start the image from the tag:
   ```bash
   git checkout v1.0.0
   ```
   Then deploy the same way as before.
3. **The data.** Version 1 runs on a database that version 2 has already upgraded: it ignores the new tables and columns (checked). Coins, orders and history made under version 2 stay. Tasks created on the admin site are hidden by version 1, not deleted, and come back with version 2. Restoring the copy from step 1 is only needed to return the data exactly as it was before version 2.

## 1.0.0

The first version: invite-only bot and mini app, tasks for coins, shop, events with QR passes, levels and a leaderboard, demo mode and the shared invite link. The team works in the bot.
