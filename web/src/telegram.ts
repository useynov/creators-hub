// A thin, defensive wrapper around Telegram's mini app bridge.
// Outside Telegram (local preview in a browser) every call is a quiet no-op.

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { photo_url?: string } };
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  openLink?(url: string): void;
  openTelegramLink?(url: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'success' | 'warning' | 'error'): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const tg = window.Telegram?.WebApp;
const atLeast = (version: string): boolean => Boolean(tg?.isVersionAtLeast?.(version));

export const initData = tg?.initData ?? '';
export const inTelegram = Boolean(initData);

/**
 * The creator's own Telegram photo, when Telegram shares it. Shown only to the creator, and only
 * until the Hub has their Instagram avatar. It is not checked by the server, so it is never stored.
 */
const ownPhoto = tg?.initDataUnsafe?.user?.photo_url;
export const telegramPhoto = ownPhoto?.startsWith('https://') ? ownPhoto : null;

export function start(): void {
  tg?.ready();
  tg?.expand();
}

/** Paints Telegram's own header and overscroll area to match the screen. */
export function setChrome(color: string): void {
  if (!inTelegram) return;
  if (atLeast('6.9')) tg?.setHeaderColor?.(color);
  if (atLeast('6.1')) tg?.setBackgroundColor?.(color);
}

/** Opens a t.me link natively: a chat, a group, the bot itself. */
export function openTelegram(url: string): void {
  if (inTelegram && tg?.openTelegramLink && atLeast('6.1')) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

/** Opens an outside page in the phone's browser. */
export function openExternal(url: string): void {
  if (inTelegram && tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function closeApp(): void {
  if (inTelegram) tg?.close();
}

export function buzz(kind: 'tap' | 'success' | 'error' = 'tap'): void {
  if (!inTelegram || !atLeast('6.1')) return;
  if (kind === 'tap') tg?.HapticFeedback?.impactOccurred('light');
  else tg?.HapticFeedback?.notificationOccurred(kind);
}
