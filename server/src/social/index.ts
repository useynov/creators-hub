// Picks the source of public profile and post data: Apify when there is a token,
// otherwise the demo provider, so the whole Hub works without one.

import { config } from '../config.js';
import { createApifyProvider } from './apify.js';
import { demoProvider } from './demo.js';
import type { SocialProvider } from './types.js';

let current: SocialProvider | null = null;

export function getProvider(): SocialProvider {
  current ??= config.apifyToken ? createApifyProvider(config.apifyToken) : demoProvider;
  return current;
}

/** For tests: put a scripted provider in place. null goes back to the default choice. */
export function setProvider(next: SocialProvider | null): void {
  current = next;
}

export { cleanHandle, parseLink } from './links.js';
export type * from './types.js';
