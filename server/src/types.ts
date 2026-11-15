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
}

export interface EventView {
  id: string;
  title: string;
  date: string | null;
  time: string | null;
  monthHint: string | null;
  place: string | null;
  description: string | null;
  taskId: string | null;
  taskReward: number | null;
  going: boolean;
  code: string | null;
  checkedIn: boolean;
  reminded: boolean;
}

export interface NewsView {
  id: string;
  title: string;
  summary: string | null;
  date: string | null;
  url: string | null;
}

export interface OfferView {
  id: number;
  campaign: string;
  fee: string;
  need: string;
  postBy: string;
  answerBy: string;
  status: 'open' | 'accepted' | 'declined';
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
