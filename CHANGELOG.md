# Changelog

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
