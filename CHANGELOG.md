# Changelog

## 4.3.0 (25 November 2026)

**Type "/" in the bot and see every command you may use.**

- **Creators** see what is theirs: `/start` and `/clear`.
- **Each person on the team** sees the full list for their role in their private chat with the bot: review, tasks, invites, account checks, the admin sign-in. Owners also see coins by hand, levels, paid offers, sample data, the age refusal and `/startover`. A Viewer sees `/start`, `/admin` and `/clear`.
- **The team group**, when one is set, sees the team's commands that work in a group.
- The list follows the role: it changes when someone is added to the team, changes role or is removed on the admin site, and when demo mode is switched. Someone added before they ever opened the bot gets theirs with their first message.
- **How Telegram behaves:** tapping a command in the list sends it at once. A command that needs details (a username, a task) then answers with an example, and nothing happens until it is sent with them.
- The list is only a shortcut. Who may run a command is still checked when it arrives.

**Data.** One line in `meta` (`menu_chats`) remembers who has a list of their own. Going back: image `creators-hub:rollback-v4.2.0-20261125`. The team's own lists then stay in Telegram as they are; every command in them exists in 4.2.0 too, so nothing breaks.

## 4.2.0 (25 November 2026)

**Tasks tab: Open, Mine, Done.** It always opens on Open.

- **Soon is gone.** No Soon tab, no "Remind me", no bot reminder. A task shows the moment it is published.
- **A task's Start date is again only a check:** a post published before that date is not accepted. It no longer holds the task back. A task that should not be visible yet stays a draft until the day.

**Rewards is now Shop.** The middle tab is called Shop and opens the shop itself.

- Coins and their history are one tap away: the coin chip at the top of every main screen, and "Your coins" at the bottom of the shop.
- "Your orders" is at the bottom of the shop too; an order on its way stays as a line at the top.

**Free items, and one a month.**

- **Price 0 means free.** The app says "Free" instead of coins, the button says "Get it free", nothing is written to the wallet.
- **Per creator per month:** a new limit next to "At most per creator". The count starts again on the 1st; a cancelled order gives the month back. The creator sees "You have November's. Next one from 1 December."
- **Own choice instead of a size:** for things chosen by drink or colour. The team writes the options one per line and names the choice ("Drink"). An item has either sizes or its own choice, not both.
- **Free items go only to creators whose account is confirmed,** so a new sign-up cannot order a case before the team has looked at the account.
- A free item with a monthly limit sits at the top of the shop as its own card.

**Data.** Three new columns on shop items (`choices`, `choice_label`, `per_month`), added on start; nothing existing changes. The `task_reminders` table stays, unused. Going back: image `creators-hub:rollback-v4.1.0-20261125`; the older code ignores the new columns, and reads a free item as costing 0 coins.

## 4.1.0 (25 November 2026)

**`/clear`: empty the chat with the bot.** Anyone can send it in their private chat with the bot; it is also in the bot's command menu.

- The bot deletes its own messages and yours, then a short "Cleared" note that removes itself after a few seconds.
- **Telegram's limit:** a bot can delete only messages from the last 48 hours. Older ones stay; Telegram's own "Clear history" removes those.
- A bot cannot read a chat's history, so it walks back over the latest 2,000 message numbers. With many creators writing at once that may not reach back a full 48 hours. One full sweep per person every 20 seconds.
- In a group it does nothing but say so. It never touches another chat.

**Data.** No change. Going back: image `creators-hub:rollback-v4.0.0-20261125`.

## 4.0.0 (25 November 2026)

A new Home, a new Tasks tab and the Hub's own stories, built from the design canvas "For the build".

**Home**
- **The header says "Creators Hub" first**, with the Coca-Cola script as a small line above it. The balance chip says "85 coins".
- **The creator's photo in a ring.** The ring fills as the rating nears the next level; a badge shows rating and threshold ("96 / 150"). Under the name: the level, the place this month, and how many points are left to the next level.
- **Stories** in a row of circles under it (see below).
- **Open tasks:** only tasks the creator can join today, as compact cards (cover, format, reward, title, one line, time left with a thin bar). Their own work in progress is not on Home any more: it lives in the Tasks tab.
- **"1 task needs a fix":** one amber line when the team has sent work back. It opens that task.
- **Coming up:** the next two events with a date. "I'm in" answers from Home.
- The News block and the "In the Hub" list are gone: stories carry the news. The paid offer card and the account note stay.

**Tasks tab: Mine, Open, Soon, Done**
- **Mine** is the creator's own work, the one that needs a fix first, with the team's comment on the card and the next step as a button. The tab opens here when there is something in it, otherwise on Open.
- **Open** is everything that can be joined now.
- **Soon** is new: a task with a start date ahead. It is announced with its date and reward, cannot be joined yet, and its brief stays closed until it opens. **Remind me** makes the bot message the creator when it opens.
- **Done** sums up the month and lists approved work with its views and coins.
- The word stays "Tasks" everywhere.

**Stories: the Hub's news channel**
- Full screen, like Instagram stories: a photo or a flat colour, a line over the headline, a headline, a short text, one button into the app. Tap right for the next, left for the one before, hold to pause; each stays 8 seconds. With "reduce motion" on the phone, nothing moves by itself.
- A red ring until the creator has opened a story, grey after. New ones come first. A story stays up until its last day, or until the team takes it down.
- **Admin site, new Stories section** (Owner and Manager): upload a vertical photo, write the words, choose where the button leads (a main screen, a task, an event, a shop item), set the last day, see it as the creator will, send it to your own Telegram to check it in the real app, put it up or take it down. A story goes up without a bot message. The site shows how many creators opened each one.

**What changes for the team**
- **A task's Start date now matters to creators.** Before, it was only used to check when a post was published. Now a start date ahead puts the task under Soon and nobody can join until then. A creator who joined earlier is not affected.
- "Shoot the New Year caravan" in the content file no longer has a start date, so creators can sign up for it ahead of the day.
- `/startover`, the sample data and the age refusal also clear reminders and opened stories.

**Fixes**
- **TCCC Unity and the Coca-Cola script were never live.** Since 3.1.0 the five font files and the two logo files sat on the server readable only by root, so the image build copied them as empty files. Every phone showed Onest and "Coca-Cola" in plain type. The files are readable now, the server answers 404 for an empty brand file (so the fallback is deliberate, not an accident) and says so in its log at start. The SVG also states its size, and the app tries the same mark as a picture before it falls back to type. The font and logo files are asked for under a new address (`?v=2`), because phones and the CDN had cached the empty copies for a day.
- A story could be skipped when the one before it ran out. Found in testing, fixed before release.

**Data.** Three tables are added on start: `task_reminders`, `hub_stories`, `hub_story_views`. Nothing is removed or changed. Going back: image `creators-hub:rollback-v3.5.0-20261125`; 3.5.0 runs on the same database and simply ignores the new tables, but `/startover` of 3.5.0 will fail for an owner who has set a reminder or opened a story.

## 3.5.0 (25 November 2026)

**`/startover`: see the creator's path again from the first screen.** An owner who is also signed up as a creator could never see the welcome, the age question or the Instagram step again. Now they can.

- Send `/startover` to the bot in a private chat. It lists what would go: the tasks you joined, your publications and their numbers, coins, orders, payout requests, event RSVPs, your Instagram account, level and details.
- Nothing is removed until you send `/startover yes`. It cannot be undone.
- Only your own account, and only for owners. A Manager, a creator, or anyone in a group chat gets a refusal.
- What stays: your team role and admin sign-in, the tasks and shop items you made, and everything about other creators. An order that was not delivered gives its item back to the stock. Your avatar and story copies are deleted from the disk.
- After that, `/start` brings you in as a new creator. Your new account waits for the team like anyone's: confirm it with `/confirm` and your Telegram ID, or on the admin site.

**Data.** Nothing changes in the database layout. Going back: image `creators-hub:rollback-v3.4.0-20261125`.

## 3.4.0 (25 November 2026)

- **Creator app, Home: the creator's photo next to "Hi, name".** It is the same Instagram avatar the profile shows; a tap opens the profile.
- **A photo before Instagram is read.** While the Hub has no Instagram avatar for a creator, they see their own Telegram photo instead of a letter, on Home and on the profile. Only the creator sees it: it is not stored, and the admin site is unchanged.
- **The narrowest phones (320 px):** "Creators Hub" beside the logo is left out there, so it no longer runs under the coin balance.

**Data.** Nothing changes in the database. Going back: image `creators-hub:rollback-v3.3.0-20261125`.

## 3.3.0 (24 November 2026)

The shop, rebuilt end to end. Before this version an item could only be added by editing a file on the server, it could not have a photo from the admin site, and a creator had no page for an item and no way to follow an order.

**Admin: a Shop section**
- **Add and change items on the site**, from a laptop or a phone: name, description, price, section, sizes, how it is delivered, how many are left, a limit per creator, shown or hidden.
- **Photos:** up to six per item, uploaded right there (several at once, also straight from a phone camera). The first one is the cover; photos can be reordered and removed. Large phone photos are turned upright and scaled down in the browser before upload, so the 5 MB limit is no longer in the way. The same now applies to task covers.
- **Check before you show:** the editor shows the item as the creator will see it, in the list and on its page, while you type. "Open in the app" makes the bot send you a button that opens the item in the real app on your phone, also while it is still hidden from creators.
- **The shelf:** items can be moved up and down; creators see them in that order. An item with orders can be hidden but not removed, so old orders keep their name.
- **The content file no longer overwrites the shop.** `content/seed.json` only fills an empty shop. An item added or edited on the site is never touched by it again, and neither is a stock count.

**Admin: orders**
- Each order shows the photo of the item, and "Send in Telegram" instead of an address for things that are not shipped.
- **Cancel with a reason**, until the order is delivered: the coins go back to the creator, the item goes back to the stock, and the bot tells the creator why. Cancelled orders have their own tab.

**Creator app**
- **Every item has its own page:** photos to swipe through, the description, sizes, how it arrives, and how many are left. Items that are still out of reach can be opened too, with a line showing how many coins are missing.
- **Stock and limits:** "Only 2 left", "Sold out", "You already ordered it". The last one goes to whoever orders first.
- **Ordering:** the sizes the item really has; no address is asked for something sent in Telegram; one line says what is still missing instead of a silently grey button.
- **Your orders:** a new screen with every order and where it stands (ordered, packed, on its way, delivered). An order can be cancelled by the creator until the team has packed it; the coins come straight back. The bot's order messages open this screen.

**Data.** New columns are added to `shop_items` and `orders` on start; nothing is removed. Going back to 3.2.1 (image `creators-hub:rollback-v3.2.1-20261124`) works on the same database, but that version does not know cancelled orders or the Shop section.

## 3.2.1 (24 November 2026)

- **Older iPhones.** The build shortened the phone rule of the admin to a newer notation that iOS before 16.4 does not read, so those phones would have shown the laptop layout. Styles are now written out for phones a few years old (`cssTarget` in both Vite configs).
- **Creator app, Home:** "Creators Hub" next to the logo no longer runs into the coin balance on a narrow phone.

## 3.2.0 (24 November 2026)

The admin works on a phone. Nothing changes on a laptop.

Under 860px of width:

- **Menu.** The black column folds into a top bar with the logo and a "Menu" button. The button shows how many things wait for a person; the sections open as a full-screen menu.
- **Tables are cards.** A row becomes a small card: its first cell is the title, every other cell carries the name of its column, and the actions take the full width. Nothing scrolls sideways any more. Where a table can be sorted, the sortable columns stay as a strip of buttons above the list.
- **Review in two steps.** First the queue; a tap opens the work with a "Back to the queue" button. The approve button is full width, and "what to fix" sits on its own lines.
- **Touch sizes.** Buttons and fields are at least 44px high, and fields use 16px text so iOS does not zoom into them.
- **Tabs** stay on one line and slide sideways. Pages, cards and forms are one column, and long statuses wrap inside their card.

**Going back to 3.1.0:** image `creators-hub:rollback-v3.1.0-20261124` on the server. Same database.

## 3.1.0 (24 November 2026)

The real brand assets, found on Tarlan's Mac.

- **Font: TCCC Unity**, the Coca-Cola typeface, in the creator app and the admin. Headlines and big figures use the Headline cut (Black and Bold), everything else the Text cut (Regular, Medium, Bold).
- **Unity has Latin letters only.** Russian and Kazakh text, and the tenge sign, are shown in Onest, which stays as the second font. When the app is translated, Cyrillic screens will be in Onest unless a Cyrillic Unity is found.
- **Logo: the Coca-Cola script.** On Home it stands next to "Creators Hub"; it is on the welcome photo, on the event pass, in the admin menu and on the admin login. It was traced from the PNG in Downloads into a clean vector and coloured in the exact brand red.
- "Coca-Cola" in a title is never broken at its hyphen.
- **The font and the logo are not in this repository**, like the photos: they live in `content/brand/` on the server and are served at `/brand/`. See README, "Brand assets". Without them the app falls back to Onest and sets the name in type.

**Going back to 3.0.0:** image `creators-hub:rollback-v3.0.0-20261124` on the server. Same database.

## 3.0.0 (24 November 2026)

A new look for the creator app and the admin, built on the Coca-Cola design system. Nothing changes in how the Hub works: the same screens, the same data, the same bot.

**The idea: one red thread.** A white and black base, one red (`#F40009`), a thin red line that runs through the screens, film photos, big numerals.

**Creator app**
- **Font:** Onest instead of Figtree. It has the same character and it has Cyrillic, so Russian and Kazakh will look right when the app is translated.
- **Colour:** the warm beige is gone. Pages are white, text is black, and red is kept for the brand moment of a screen and its one main action.
- **Shape:** everything you can press is a pill; cards have one radius. Lists sit on the page between hairlines instead of in boxes.
- **The thread:** level progress, the timeline of a work in review, the tab you are on and the tabs inside a screen are all the same thin red line.
- **Home** leads with one photo, the next task. Level, the next event, news and the chat are quiet rows under it.
- **Tasks** are photo cards with the title and the reward on the photo. A task opens edge to edge, with numbered steps and the main button always in reach at the bottom.
- **Events** are led by the day of the month, set big. No photo needed.
- **Shop:** merch is shown as flat colour tiles with the name set big. We have no real product photos yet and a made-up one would be a promise we cannot keep. A real photo, once added as `imageUrl`, takes the tile.
- **Welcome and the paid offer** open with a brand photo.
- One uppercase line per screen at most, sentence case everywhere else. No icons in coloured circles.

**Admin**
- The same font, colours and pills. The side menu is black; the page you are on is white.
- **Overview:** what waits for a person is four cards led by the count, red only when it is not zero. The numbers of the month are one strip, not a row of equal boxes.
- Links are black and underlined; red is not a link colour. Tabs are words on a hairline. The selected work in Review is a sunken row, without a coloured edge.
- Creator names are no longer cut by the "sample" badge. The page action stays at the right when a long title wraps.

**Photos**
- The nine AI-made photos are gone. The app now uses cuts of the four brand photos of the design system (`scripts/brand-photos.mjs`).
- **They are not in this repository**, which is public: they live in `content/brand/` on the server only. See README, "Brand photos". Without them the app works and photo blocks turn flat.

**Going back to 2.1.1.** On the server the previous image is kept as `creators-hub:rollback-v2.1.1-20261124` and the data as `~/creators-hub-backups/data-20261124-before-v3.0.0`. The database is the same in both versions, so going back is only a change of image.

## 2.1.1 (24 November 2026)

- The brand account creators must tag is **@cocacola_kaz** (Coca-Cola Kazakhstan, checked live). The earlier placeholder did not exist on Instagram.

## 2.1.0 (24 November 2026)

- **Event pages.** The Events tab is a list; tapping an event opens its own page with the photo, date and place, the programme, how many creators are coming, the linked task, and the RSVP. Events in `content/seed.json` have a new `details` text for that page.
- **Creator card in the admin.** The bio and the date of birth are in the header next to the photo. "Posts for the Hub" replaces the creator's general Instagram posts: it shows what they published for the Hub's tasks, with the numbers and a link to the task's report.
- **Sample data.** `/sampledata on` in the bot (owners only) loads 20 made-up creators with work, four measurements, stories, orders, payouts and RSVPs, so every screen and the Excel report can be looked at. They are marked "sample", never get a message, and their made-up links are never read from Instagram. `/sampledata off` removes all of it and leaves real creators untouched. Remove it before real creators join: until then the sample creators are on the leaderboard too.

## 2.0.1 (24 November 2026)

Found by the first live test with a real Apify token.

- **Fixed:** an Instagram handle that does not exist was accepted at sign-up with an empty profile. It is now refused as "not found", as decided.
- **Added:** average reel views. The profile reader returns recent posts without view counts, so the views are now read with a second reader in the background, right after a creator connects and at every refresh. "Is this you?" stays fast.

## 2.0.0 (November 2026)

The second version of Creators Hub. Version 1 is kept as the branch `v1`.

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

Open `https://<your address>/version`. Version 2 answers with its number, for example `{"name":"creators-hub","version":"2.0.1"}`. Version 1 does not answer with a version there.

### Going back to version 1

Version 1 is the branch `v1` (the last commit of `main` before version 2). Nobody works in that branch: it only marks the place to return to.

1. **Before the first start of version 2, copy the data.** On the server:
   ```bash
   docker volume ls | grep hub-data
   ```
   ```bash
   docker run --rm -v creators-hub_hub-data:/data -v "$PWD":/backup alpine tar czf /backup/hub-data-before-v2.tgz -C /data .
   ```
   Use the volume name the first command prints if it differs from `creators-hub_hub-data`.
2. **To return the code,** revert the merge of version 2 on GitHub (open the merged pull request, press Revert, merge the new pull request), or build and start the image from the `v1` branch:
   ```bash
   git checkout v1
   ```
   Then deploy the same way as before.
3. **The data.** Version 1 runs on a database that version 2 has already upgraded: it ignores the new tables and columns (checked). Coins, orders and history made under version 2 stay. Tasks created on the admin site are hidden by version 1, not deleted, and come back with version 2. Restoring the copy from step 1 is only needed to return the data exactly as it was before version 2.

## 1.0.0

The first version: invite-only bot and mini app, tasks for coins, shop, events with QR passes, levels and a leaderboard, demo mode and the shared invite link. The team works in the bot.
