import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root, whether we run from src (tsx) or dist (node). */
export const rootDir = resolve(here, '../..');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function idList(value: string | undefined): number[] {
  return (value ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id !== 0);
}

export const config = {
  isProd,
  botToken: env.BOT_TOKEN?.trim() ?? '',
  webappUrl: (env.WEBAPP_URL ?? '').trim().replace(/\/+$/, ''),
  port: Number(env.PORT ?? 3000),
  adminIds: idList(env.ADMIN_IDS),
  adminChatId: env.ADMIN_CHAT_ID ? Number(env.ADMIN_CHAT_ID) : null,
  communityChatUrl: env.COMMUNITY_CHAT_URL?.trim() || null,
  welcomeVideo: env.WELCOME_VIDEO?.trim() || null,
  dbPath: resolve(rootDir, env.DATABASE_PATH ?? './data/hub.db'),
  /** Uploaded and downloaded files: task covers, avatars, story copies, screenshots. Lives next to the database. */
  mediaDir: resolve(rootDir, env.MEDIA_DIR ?? resolve(dirname(resolve(rootDir, env.DATABASE_PATH ?? './data/hub.db')), 'media')),
  /** Apify API token for reading public Instagram and TikTok data. Without it the demo provider answers. */
  apifyToken: env.APIFY_TOKEN?.trim() || null,
  /** Browser preview without Telegram. Never honoured in production. */
  devUserId: !isProd && env.DEV_USER_ID ? Number(env.DEV_USER_ID) : null,
  webDist: resolve(rootDir, 'web/dist'),
  adminDist: resolve(rootDir, 'admin/dist'),
};

export interface HubSettings {
  brandName: string;
  brandInitials: string;
  timeZone: string;
  currencySign: string;
  reviewTime: string | null;
  cities: string[];
  levels: { pro: number; partner: number };
  rating: { perPublication: number; perScorePoint: number; viewsPerPoint: number };
  cashout: { rateKzt: number | null; minCoins: number | null; method: string | null };
  topPerformerBonus: number | null;
  checkinCoins: number;
  /** Creators must be at least this old. */
  minAge: number;
  /** How long the team takes to confirm a new account, as shown to creators. */
  accountConfirmTime: string | null;
  metrics: {
    /** Hours after submission for the three follow-up measurements. The last one is final. */
    scheduleHours: [number, number, number];
    /** How many of the latest publications the profile averages are counted over. */
    profileSample: number;
    /** Days between automatic refreshes of a creator's profile data. */
    profileRefreshDays: number;
  };
}

export const settings: HubSettings = JSON.parse(
  readFileSync(resolve(rootDir, 'content/settings.json'), 'utf8'),
);

export function isAdmin(telegramId: number): boolean {
  return config.adminIds.includes(telegramId);
}
