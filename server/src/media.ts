// Files we keep ourselves: task covers uploaded by the team, creators' avatars,
// copies of stories, screenshots of story statistics.
//
// Two zones under config.mediaDir:
//   public/   served to anyone at /media/<path> (covers, avatars, thumbnails)
//   private/  never served by a static route. Only the admin API hands these out,
//             after checking the role (story copies, statistics screenshots).
//
// Names are generated here, never taken from a user or a remote server.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { config } from './config.js';

export type MediaZone = 'public' | 'private';

/** What we accept, by magic bytes. The extension always comes from this table. */
const SIGNATURES: Array<{ ext: string; mime: string; test: (bytes: Buffer) => boolean }> = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'mp4', mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
];

export const MEDIA_MIME: Record<string, string> = Object.fromEntries(SIGNATURES.map((s) => [s.ext, s.mime]));

export function sniff(bytes: Buffer): { ext: string; mime: string } | null {
  const hit = SIGNATURES.find((signature) => bytes.length >= 12 && signature.test(bytes));
  return hit ? { ext: hit.ext, mime: hit.mime } : null;
}

const zoneDir = (zone: MediaZone): string => resolve(config.mediaDir, zone);

/**
 * Resolves a stored relative path (e.g. "avatars/ab12.jpg") inside a zone.
 * Returns null for anything that would leave the zone.
 */
export function mediaFile(zone: MediaZone, relativePath: string): string | null {
  const root = zoneDir(zone);
  const file = resolve(root, normalize(relativePath));
  return file === root || file.startsWith(root + sep) ? file : null;
}

export interface SavedMedia {
  /** Relative path inside the zone, to store in the database. */
  path: string;
  /** For the public zone: the address to put in an <img>. null for private files. */
  url: string | null;
  mime: string;
  bytes: number;
}

/**
 * Saves bytes under <zone>/<folder>/<random>.<ext>. The type is decided by the content.
 * Throws when the content is not an image or video we accept, or is too large.
 */
export async function saveMedia(
  zone: MediaZone,
  folder: 'covers' | 'avatars' | 'thumbs' | 'stories' | 'screens' | 'seed',
  bytes: Buffer,
  options: { maxBytes?: number; allow?: string[] } = {},
): Promise<SavedMedia> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (bytes.length === 0) throw new Error('empty file');
  if (bytes.length > maxBytes) throw new Error('file too large');
  const kind = sniff(bytes);
  if (!kind || (options.allow && !options.allow.includes(kind.ext))) throw new Error('unsupported file type');

  const path = `${folder}/${randomBytes(12).toString('hex')}.${kind.ext}`;
  const file = join(zoneDir(zone), path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { path, url: zone === 'public' ? `/media/${path}` : null, mime: kind.mime, bytes: bytes.length };
}

export async function readMedia(zone: MediaZone, relativePath: string): Promise<{ data: Buffer; mime: string } | null> {
  const file = mediaFile(zone, relativePath);
  if (!file) return null;
  try {
    const data = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    return { data, mime: MEDIA_MIME[ext] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

/**
 * Downloads a remote image or video (an avatar, a story) so we keep our own copy.
 * Only https, only public hosts, with a size cap and a timeout. Returns null on any failure:
 * a missing picture must never break the flow that asked for it.
 */
export async function downloadMedia(url: string, maxBytes = 30 * 1024 * 1024, timeoutMs = 20_000): Promise<Buffer | null> {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    let next = url;
    let response: Response | null = null;
    // Redirects are followed by hand so that every hop is checked, not only the first address.
    for (let hop = 0; hop < 4; hop++) {
      const target = new URL(next);
      if (target.protocol !== 'https:' || isPrivateHost(target.hostname)) return null;
      const answer = await fetch(target, { signal, redirect: 'manual' });
      const location = answer.headers.get('location');
      if (answer.status >= 300 && answer.status < 400 && location) {
        next = new URL(location, target).toString();
        continue;
      }
      response = answer;
      break;
    }
    if (!response || !response.ok || !response.body) return null;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) return null;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > maxBytes) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** Refuses hosts that point back into our own network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) return true; // IPv6 literals: not needed for the CDNs we read
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number) as [number, number, number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return !host.includes('.');
}
