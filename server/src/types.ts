// Shapes shared by the API and the mini app. Keep this file free of imports:
// the web app pulls it in as types only.

export type Level = 'member' | 'pro' | 'partner';
export type ReviewMode = 'post_first' | 'draft_first';
export type EntryStatus =
  | 'joined'
  | 'draft_review'
  | 'draft_changes'
  | 'draft_approved'
  | 'in_review'
  | 'needs_changes'
  | 'approved';

export interface PublicSettings {
  brandName: string;
  brandInitials: string;
  botUsername: string | null;
  communityChatUrl: string | null;
  timeZone: string;
  currencySign: string;
  reviewTime: string | null;
  cities: string[];
  levels: { pro: number; partner: number };
  cashout: { rateKzt: number | null; minCoins: number | null; method: string | null };
  topPerformerBonus: number | null;
  checkinCoins: number;
  /** Creators must be at least this old. */
  minAge: number;
  /** How long the team takes to confirm a new account, e.g. "24 hours". */
  accountConfirmTime: string | null;
}

export interface Me {
  id: number;
  firstName: string;
  username: string | null;
  instagram: string | null;
  tiktok: string | null;
  city: string | null;
  size: string | null;
  address: string | null;
  phone: string | null;
  onboarded: boolean;
  balance: number;
  rating: number;
  level: Level;
  nextLevel: Exclude<Level, 'member'> | null;
  nextThreshold: number | null;
  /** 0..1, how far the rating is toward the next level */
  progress: number;
  stats: { publications: number; views: number; teamScore: number | null };
  rank: number | null;
  /** Our copy of the Instagram profile picture, under /media. null: show the initial. */
  avatarUrl: string | null;
  /** The team's confirmation that the Instagram account is the creator's own. */
  accountStatus: AccountStatus;
  /** The team's reason when the account was rejected. */
  accountNote: string | null;
  /** The age question has been answered. */
  hasBirthDate: boolean;
}

export interface Bootstrap {
  me: Me;
  settings: PublicSettings;
}

export interface EntryView {
  id: number;
  status: EntryStatus;
  joinedAt: string;
  links: string[];
  note: string | null;
  submittedAt: string | null;
  draftLink: string | null;
  draftSentAt: string | null;
  draftApprovedAt: string | null;
  comment: string | null;
  commentAt: string | null;
  approvedAt: string | null;
  reward: number | null;
  ratingDelta: number | null;
  views: number;
}

export interface TaskView {
  id: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  reward: number;
  format: string | null;
  date: string | null;
  place: string | null;
  deadline: string;
  closed: boolean;
  reviewMode: ReviewMode;
  viewsBonus: boolean;
  steps: string[];
  entry: EntryView | null;
  /** Plain text: paragraphs split by a blank line, a short first line may be a heading. */
  brief: string | null;
  /** Kinds of publication the task accepts. Empty: any. */
  formats: PublicationKind[];
  requiredMention: string | null;
  requiredHashtag: string | null;
  startsAt: string | null;
  bonusCoins: number | null;
  /** How many links one creator may send. */
  maxPublications: number;
  /** The participant limit is reached: nobody new can join. */
  full: boolean;
  /** Why this creator cannot take the task (a rejected account), or null. */
  locked: string | null;
  /** The creator's publications for this task, with their numbers. */
  publications: PublicationView[];
  /** The latest send while its links are checked, or when a link was refused. */
  submission: SubmissionView | null;
}

export type AccountStatus = 'pending' | 'confirmed' | 'rejected';
export type PublicationKind = 'reel' | 'post' | 'story' | 'tiktok' | 'unknown';
export type CheckResult = 'pass' | 'fail' | 'unknown';

export interface CheckView {
  ownAccount: CheckResult;
  afterStart: CheckResult;
  mention: CheckResult;
  hashtag: CheckResult;
  format: CheckResult;
  reachable: CheckResult;
}

export interface PublicationView {
  id: number;
  url: string;
  kind: PublicationKind;
  status: 'tracking' | 'final' | 'removed' | 'unreachable';
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** 'creator' for story views the creator told us. */
  viewsSource: 'auto' | 'creator' | 'none';
  checks: CheckView;
  /** A story whose views the creator can send now. */
  storyViewsOpen: boolean;
}

export interface BlockedLink {
  url: string;
  /** Who published it, as Instagram or TikTok says. */
  author: string | null;
  /** The account connected in the Hub. */
  expected: string | null;
}

export interface SubmissionView {
  id: number;
  status: 'checking' | 'blocked' | 'done';
  links: string[];
  blocked: BlockedLink[];
  createdAt: string;
}

export interface ConnectProfile {
  handle: string;
  fullName: string | null;
  avatarUrl: string | null;
  followers: number | null;
  postsCount: number | null;
}

/** The "Find my profile" flow. */
export interface ConnectView {
  status: 'idle' | 'searching' | 'found' | 'private' | 'not_found' | 'error';
  handle: string | null;
  profile: ConnectProfile | null;
}

/** The screen that asks for the number of story views. */
export interface StoryView {
  id: number;
  taskId: string;
  taskTitle: string;
  postedAt: string;
  /** We kept a copy of the story while it was live. */
  hasCopy: boolean;
  /** The copy is a picture the app can show (a video copy is only mentioned). */
  copyIsImage: boolean;
  views: number | null;
  answeredAt: string | null;
  hasScreenshot: boolean;
  /** The creator can still send or correct the number. */
  editable: boolean;
}

export interface EventView {
  id: string;
  title: string;
  date: string | null;
  time: string | null;
  monthHint: string | null;
  place: string | null;
  description: string | null;
  /** The longer text for the event's own page. */
  details: string | null;
  taskId: string | null;
  /** The linked task's title, when this creator can see that task. */
  taskTitle: string | null;
  taskReward: number | null;
  /** How many creators said they are coming. */
  goingCount: number;
  going: boolean;
  code: string | null;
  checkedIn: boolean;
  reminded: boolean;
  coverUrl: string | null;
}

export interface NewsView {
  id: string;
  title: string;
  summary: string | null;
  date: string | null;
  url: string | null;
  /** A screen of the mini app to open, e.g. /events. */
  path: string | null;
  coverUrl: string | null;
}

export interface OfferView {
  id: number;
  campaign: string;
  fee: string;
  need: string;
  postBy: string;
  answerBy: string;
  status: 'open' | 'accepted' | 'declined';
  /** The detailed brief, plain text, when the team wrote one. */
  brief: string | null;
}

export interface HomeView {
  nextTask: TaskView | null;
  newCount: number;
  nextEvent: EventView | null;
  news: NewsView | null;
  offer: OfferView | null;
}

export interface LedgerRow {
  id: number;
  title: string;
  kind: 'task' | 'order' | 'bonus' | 'event' | 'cashout';
  amount: number;
  createdAt: string;
}

export interface WalletView {
  balance: number;
  history: LedgerRow[];
}

export interface ShopItemView {
  id: string;
  title: string;
  price: number;
  category: 'merch' | 'gift';
  imageUrl: string | null;
  needsSize: boolean;
}

export interface ShopView {
  balance: number;
  items: ShopItemView[];
}

export interface LeaderRow {
  rank: number;
  handle: string;
  views: number;
  isMe: boolean;
}

export interface LeaderboardView {
  period: 'month' | 'all';
  me: { rank: number; views: number } | null;
  top: LeaderRow[];
}

export interface EventsView {
  upcoming: EventView[];
  past: EventView[];
}
