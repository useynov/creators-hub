// Shapes of the admin API (/api/admin/*). The admin site imports this file as types only,
// so it must stay free of runtime code and of imports that pull in Node or the database.

import type { EntryStatus, Level, ReviewMode } from '../types.js';

export type { EntryStatus, Level, ReviewMode };

export type TeamRole = 'owner' | 'manager' | 'viewer';
export type AccountStatus = 'pending' | 'confirmed' | 'rejected';
export type ProfileStatus = 'ok' | 'private' | 'not_found' | 'error';
export type TaskStatus = 'draft' | 'active' | 'closed';
export type PublicationKind = 'reel' | 'post' | 'story' | 'tiktok' | 'unknown';
export type PublicationStatus = 'tracking' | 'final' | 'removed' | 'unreachable';
export type CheckResult = 'pass' | 'fail' | 'unknown';
export type OrderStatus = 'new' | 'packed' | 'shipped' | 'delivered';
export type PayoutStatus = 'new' | 'paid' | 'rejected';
export type SnapshotKind = 'submit' | 'h24' | 'd7' | 'd14';

/** Every error from the API. `error` is a stable code the site translates; `message` is English. */
export interface ApiErrorBody {
  error: string;
  message: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Session -------------------------------------------------------------

export interface LoginInfo {
  botUsername: string | null;
  /** Only in a local preview (DEV_USER_ID, never in production). */
  devLogin: boolean;
}

export interface Counters {
  pendingAccounts: number;
  review: number;
  newOrders: number;
  payoutRequests: number;
}

export interface AdminMe {
  id: number;
  name: string;
  role: TeamRole;
  /** null for the Viewer, who sees reports only. */
  counters: Counters | null;
  settings: {
    brandName: string;
    timeZone: string;
    currencySign: string;
    cities: string[];
    cashout: { rateKzt: number | null; minCoins: number | null; method: string | null };
    metricsHours: [number, number, number];
  };
  botUsername: string | null;
}

// --- Audience ------------------------------------------------------------

/** Same shape as Audience in server/src/audience.ts. */
export interface AudienceInput {
  mode: 'all' | 'segment' | 'list';
  cities?: string[];
  followersMin?: number | null;
  followersMax?: number | null;
  levels?: Level[];
  tags?: string[];
  userIds?: number[];
}

export interface AudienceCount {
  /** Creators in the Hub (account not rejected) who fit the audience. */
  count: number;
  /** Creators in the Hub whose account is not rejected. */
  total: number;
  budgetCoins: number;
  /** null until the coin rate is set. */
  budgetMoney: number | null;
}

/** Hand-picked creators of a list audience, with what is needed to show them. */
export interface CreatorPick {
  id: number;
  name: string;
  instagram: string | null;
}

// --- Overview ------------------------------------------------------------

export interface TaskFunnel {
  id: string;
  title: string;
  formats: PublicationKind[];
  place: string | null;
  audience: AudienceInput;
  deadline: string;
  joined: number;
  submitted: number;
  approved: number;
  views: number;
}

export type AlertKind = 'removed' | 'story_numbers' | 'went_private' | 'flagged';

export interface OverviewAlert {
  kind: AlertKind;
  count: number;
  /** Instagram handles (or names) of the first few creators concerned. */
  who: string[];
  /** For 'removed': the task of the first one. */
  task: string | null;
}

export interface Overview {
  month: string;
  todo: Counters & { oldestReviewAt: string | null };
  kpi: {
    creators: number;
    confirmed: number;
    activeThisMonth: number;
    publications: number;
    byKind: Partial<Record<PublicationKind, number>>;
    views: number;
    coinsIssued: number;
    /** Money per 1000 views, null until the coin rate is set or when there are no views. */
    costPer1000: number | null;
  };
  tasks: TaskFunnel[];
  alerts: OverviewAlert[];
  /** How many sample creators are loaded: the numbers on this page include them. */
  sampleCreators: number;
}

// --- Creators ------------------------------------------------------------

export type CreatorSort = 'status' | 'name' | 'followers' | 'avgViews' | 'er' | 'city' | 'level' | 'rating' | 'joined';
export type CreatorStatusFilter = AccountStatus | 'private';

export interface CreatorRow {
  id: number;
  name: string;
  username: string | null;
  instagram: string | null;
  avatarUrl: string | null;
  followers: number | null;
  avgReelViews: number | null;
  engagementRate: number | null;
  city: string | null;
  level: Level;
  rating: number;
  tags: string[];
  accountStatus: AccountStatus;
  profileStatus: ProfileStatus | null;
  /** A made-up creator from the sample data, not a person. */
  sample: boolean;
}

export interface CreatorList extends Page<CreatorRow> {
  inHub: number;
  pending: number;
}

export interface Options {
  cities: string[];
  tags: string[];
}

export interface RecentPostView {
  kind: PublicationKind;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  url: string;
}

export interface ProfileView {
  handle: string;
  fullName: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  avgReelViews: number | null;
  engagementRate: number | null;
  isPrivate: boolean;
  isVerified: boolean;
  status: ProfileStatus;
  source: 'apify' | 'demo';
  fetchedAt: string;
  recent: RecentPostView[];
}

export interface HistoryRow {
  entryId: number;
  taskId: string;
  taskTitle: string;
  status: EntryStatus;
  kinds: PublicationKind[];
  /** Summary of the publications behind the entry. */
  measuring: 'none' | 'tracking' | 'final' | 'removed';
  views: number;
  /** Part of the views stated by the creator (stories). */
  statedViews: number;
  /** Coins paid when approved, otherwise what the task pays. */
  coins: number;
  paid: boolean;
  approvedAt: string | null;
  submittedAt: string | null;
}

/** One publication the creator made for a Hub task, as shown on their card. */
export interface HubPost {
  id: number;
  entryId: number;
  taskId: string;
  taskTitle: string;
  url: string;
  kind: PublicationKind;
  /** Our own copy of the thumbnail. Stories have none here: their copy is private. */
  thumbUrl: string | null;
  publishedAt: string | null;
  /** Measured views (reels, TikTok). */
  views: number | null;
  /** Story views as stated by the creator. */
  statedViews: number | null;
  likes: number | null;
  comments: number | null;
  status: 'tracking' | 'final' | 'removed';
}

export interface CreatorCard {
  id: number;
  name: string;
  /** A made-up creator from the sample data, not a person. */
  sample: boolean;
  username: string | null;
  instagram: string | null;
  tiktok: string | null;
  city: string | null;
  avatarUrl: string | null;
  joinedAt: string | null;
  invitedVia: 'link' | 'list' | null;
  accountStatus: AccountStatus;
  accountNote: string | null;
  accountReviewedAt: string | null;
  level: Level;
  levelOverride: Level | null;
  rating: number;
  tags: string[];
  instagramProfile: ProfileView | null;
  tiktokProfile: ProfileView | null;
  history: HistoryRow[];
  /** The latest publications made for the Hub's tasks, newest first. */
  hubPosts: HubPost[];
  hub: { publications: number; views: number; teamScore: number | null; balance: number };
  wallet: Array<{ id: number; title: string; kind: string; amount: number; createdAt: string }>;
  /** Owner and Manager only. The Viewer never opens a creator card. */
  details: {
    size: string | null;
    address: string | null;
    phone: string | null;
    birthDate: string | null;
    payoutDetails: string | null;
  };
}

export interface RefreshResult {
  /** 'pending' when the provider is slow: the refresh carries on and the card shows it later. */
  state: 'done' | 'pending';
}

// --- Invitations ---------------------------------------------------------

export type InviteState = 'not_opened' | 'started' | 'pending' | 'confirmed' | 'rejected';

export interface InviteRow {
  id: number;
  who: string;
  via: 'link' | 'list';
  by: string | null;
  createdAt: string;
  state: InviteState;
}

export interface InviteLinkState {
  on: boolean;
  /** Full link when the bot's username is known, otherwise the start parameter only. */
  link: string | null;
  joined: number;
  changedAt: string | null;
}

export interface Invitations {
  link: InviteLinkState;
  recent: InviteRow[];
}

export interface InviteResult {
  results: Array<{ ref: string; result: 'added' | 'exists' | 'invalid' }>;
}

// --- Tasks ---------------------------------------------------------------

export type TaskTab = 'active' | 'draft' | 'closed';

export interface TaskRowView extends TaskFunnel {
  status: TaskStatus;
  reward: number;
  reviewMode: ReviewMode;
  reach: number;
}

export interface TaskList extends Page<TaskRowView> {
  counts: Record<TaskTab, number>;
}

/** What the editor sends. Times are wall-clock in the hub's time zone: YYYY-MM-DDTHH:mm. */
export interface TaskInput {
  title: string;
  summary: string | null;
  brief: string | null;
  steps: string[];
  place: string | null;
  date: string | null;
  coverUrl: string | null;
  formats: PublicationKind[];
  requiredMention: string | null;
  requiredHashtag: string | null;
  reviewMode: ReviewMode;
  reward: number;
  maxPublications: number;
  bonusCoins: number | null;
  maxParticipants: number | null;
  startsAt: string | null;
  deadline: string;
  audience: AudienceInput;
}

export interface TaskDetail extends TaskInput {
  id: string;
  status: TaskStatus;
  source: 'seed' | 'admin';
  announcedAt: string | null;
  /** A cover that lives on another site (from the content file): kept, not shown here. */
  remoteCover: boolean;
  picked: CreatorPick[];
  joined: number;
}

export type TaskAction = 'save' | 'publish' | 'announce';

export interface TaskSaved {
  task: TaskDetail;
  /** How many creators the bot messaged, when the action was 'announce'. null when it did not announce. */
  announced: number | null;
}

// --- Review --------------------------------------------------------------

export type ReviewQueue = 'works' | 'drafts' | 'stories';

export type ReviewFlag =
  | 'account_unconfirmed'
  | 'own_account'
  | 'after_start'
  | 'mention'
  | 'hashtag'
  | 'format'
  | 'reachable'
  | 'unchecked'
  | 'story_saved'
  | 'draft'
  | 'ok';

export interface QueueItem {
  entryId: number;
  creator: { id: number; name: string; instagram: string | null };
  task: { id: string; title: string };
  kinds: PublicationKind[];
  waitingSince: string;
  flag: ReviewFlag;
}

export interface StoryItem {
  publicationId: number;
  entryId: number;
  creator: { id: number; name: string; instagram: string | null };
  task: { id: string; title: string };
  url: string;
  createdAt: string;
  askedAt: string | null;
  answeredAt: string | null;
  views: number | null;
  /** The team has already looked at this number (kept or corrected it). */
  checked: boolean;
  hasScreenshot: boolean;
  hasCopy: boolean;
}

export interface ReviewQueues {
  counts: Record<ReviewQueue, number>;
  works: QueueItem[];
  drafts: QueueItem[];
  stories: StoryItem[];
}

export interface LinkChecksView {
  ownAccount: CheckResult;
  afterStart: CheckResult;
  mention: CheckResult;
  hashtag: CheckResult;
  format: CheckResult;
  reachable: CheckResult;
}

export interface SnapshotView {
  kind: SnapshotKind;
  dueAt: string;
  takenAt: string | null;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface PublicationView {
  id: number;
  url: string;
  kind: PublicationKind;
  status: PublicationStatus;
  authorHandle: string | null;
  publishedAt: string | null;
  /** null while the automatic check has not run yet. */
  checks: LinkChecksView | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  viewsSource: 'auto' | 'creator' | 'none';
  storyViews: number | null;
  thumbUrl: string | null;
  /** Private media, served by /api/admin/media/... to Owner and Manager. */
  storyCopyUrl: string | null;
  screenshotUrl: string | null;
  snapshots: SnapshotView[];
}

export interface EntryDetail {
  id: number;
  status: EntryStatus;
  creator: {
    id: number;
    name: string;
    instagram: string | null;
    avatarUrl: string | null;
    accountStatus: AccountStatus;
    avgReelViews: number | null;
  };
  task: {
    id: string;
    title: string;
    reward: number;
    reviewMode: ReviewMode;
    startsAt: string | null;
    requiredMention: string | null;
    requiredHashtag: string | null;
    formats: PublicationKind[];
  };
  submittedAt: string | null;
  /** Sent again after the team asked for changes. */
  resent: boolean;
  links: string[];
  note: string | null;
  lastComment: string | null;
  draftLink: string | null;
  draftInBot: boolean;
  draftSentAt: string | null;
  publications: PublicationView[];
}

// --- Report --------------------------------------------------------------

export type ReportSort = 'final' | 'date' | 'creator' | 'likes' | 'comments';
export type ViewsSourceLabel = 'auto' | 'auto_no_views' | 'creator' | 'creator_screenshot' | 'team' | 'none';

export interface ReportTask {
  id: string;
  title: string;
  status: TaskStatus;
  deadline: string;
  publications: number;
}

export interface ReportCell {
  status: 'pending' | 'done' | 'failed' | 'skipped' | 'none';
  views: number | null;
}

export interface ReportRow {
  publicationId: number;
  /** null for the Viewer: no link to the creator card. */
  creatorId: number | null;
  name: string;
  instagram: string | null;
  url: string;
  kind: PublicationKind;
  publishedAt: string | null;
  cells: Record<SnapshotKind, ReportCell>;
  /** The number that counts: the final one, or the latest so far. */
  views: number | null;
  likes: number | null;
  comments: number | null;
  source: ViewsSourceLabel;
  lastMeasuredAt: string | null;
  status: PublicationStatus;
}

export interface ReportTotals {
  publications: number;
  byKind: Partial<Record<PublicationKind, number>>;
  creators: number;
  joined: number;
  views: number;
  statedViews: number;
  likesComments: number;
  coinsPaid: number;
  approved: number;
  costPer1000: number | null;
  removed: number;
}

export interface Report extends Page<ReportRow> {
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    startsAt: string | null;
    deadline: string;
    place: string | null;
    finalAt: string | null;
  };
  totals: ReportTotals;
}

// --- Orders and payouts --------------------------------------------------

export interface OrderRowView {
  id: number;
  creator: { id: number; name: string; instagram: string | null };
  title: string;
  size: string | null;
  address: string;
  phone: string;
  coins: number;
  status: OrderStatus;
  createdAt: string;
  statusAt: string | null;
}

export interface OrderList extends Page<OrderRowView> {
  counts: Record<OrderStatus, number>;
}

export interface PayoutRowView {
  id: number;
  creator: { id: number; name: string; instagram: string | null };
  level: Level;
  coins: number;
  /** coins at the rate; null until the rate is set. */
  amount: number | null;
  details: string;
  status: PayoutStatus;
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
}

export interface PayoutList extends Page<PayoutRowView> {
  counts: Record<PayoutStatus, number>;
  canDecide: boolean;
}

// --- Team ----------------------------------------------------------------

export interface TeamRow {
  telegramId: number;
  name: string;
  username: string | null;
  role: TeamRole;
  /** From ADMIN_IDS: always Owner, cannot be changed or removed here. */
  fixed: boolean;
  lastSeenAt: string | null;
  isMe: boolean;
}
