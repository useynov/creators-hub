// What a link says about itself before anyone fetches it: which network, what kind of
// publication, and the author when the address carries one. Used to route a link to the
// right reader, and as the fallback when the reader cannot answer.

import type { Platform, PublicationKind } from '../db.js';

export interface LinkInfo {
  platform: Platform | 'other';
  kind: PublicationKind;
  /** Lower case, without @. Only when the address itself names the account. */
  author: string | null;
  /** Shortcode, story id or video id. */
  id: string | null;
}

/** Instagram and TikTok handles: letters, digits, dot and underscore. */
export const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

/**
 * Turns what a creator typed ("@Aruzhan.Vibes", "instagram.com/aruzhan.vibes/") into a handle.
 * Returns null when nothing usable is left.
 */
export function cleanHandle(value: unknown): string | null {
  const clean = String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.|m\.)?(instagram|tiktok)\.com\/@?/i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  return HANDLE_PATTERN.test(clean) ? clean : null;
}

const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const TT_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

export function parseLink(raw: string): LinkInfo {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { platform: 'other', kind: 'unknown', author: null, id: null };
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (IG_HOSTS.has(host)) {
    // instagram.com/stories/<user>/<id>
    if (parts[0] === 'stories' && parts[1] && parts[2]) {
      return { platform: 'instagram', kind: 'story', author: cleanHandle(parts[1]), id: parts[2] };
    }
    // instagram.com/[<user>/](p|reel|reels|tv)/<code>
    const at = parts.findIndex((part) => ['p', 'reel', 'reels', 'tv'].includes(part));
    if (at >= 0 && parts[at + 1]) {
      const author = at === 1 ? cleanHandle(parts[0]) : null;
      const kind: PublicationKind = parts[at] === 'p' ? 'post' : 'reel';
      return { platform: 'instagram', kind, author, id: parts[at + 1]! };
    }
    return { platform: 'instagram', kind: 'unknown', author: null, id: null };
  }

  if (TT_HOSTS.has(host)) {
    // tiktok.com/@<user>/video/<id>, /photo/<id>; vm.tiktok.com/<code> short links name nobody
    const user = parts[0]?.startsWith('@') ? cleanHandle(parts[0]) : null;
    const at = parts.findIndex((part) => part === 'video' || part === 'photo');
    return { platform: 'tiktok', kind: 'tiktok', author: user, id: at >= 0 ? (parts[at + 1] ?? null) : (parts.at(-1) ?? null) };
  }

  return { platform: 'other', kind: 'unknown', author: null, id: null };
}
