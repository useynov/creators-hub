// Reading what the admin site sends. Everything that comes in is treated as hostile:
// every field is checked for type, length and range, and anything unexpected is refused
// with a clear message instead of being coerced.

import type { Context } from 'hono';
import { HubError } from '../service.js';

export const bad = (code: string, message: string, status = 400): HubError => new HubError(code, message, status);

/** The body of a mutating request: a JSON object, nothing else. */
export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw bad('bad_body', 'The request body must be a JSON object.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw bad('bad_body', 'The request body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

// Control characters never belong in what the team types. Newlines and tabs stay only in multi-line fields.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g;
const LINE_BREAKS = /[\r\n\t]+/g;

interface TextRule {
  max: number;
  min?: number;
  required?: boolean;
  multiline?: boolean;
}

/** A text field. Empty means null. */
export function text(value: unknown, field: string, rule: TextRule): string | null {
  if (value === undefined || value === null || value === '') {
    if (rule.required) throw bad('field_required', `${field} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw bad('bad_field', `${field} must be text.`);
  let clean = value.replace(/\r\n/g, '\n').replace(CONTROL, '');
  clean = rule.multiline ? clean.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n') : clean.replace(LINE_BREAKS, ' ');
  clean = clean.trim();
  if (!clean) {
    if (rule.required) throw bad('field_required', `${field} is required.`);
    return null;
  }
  if (clean.length > rule.max) throw bad('too_long', `${field} is too long (at most ${rule.max} characters).`);
  if (rule.min && clean.length < rule.min) throw bad('too_short', `${field} is too short (at least ${rule.min} characters).`);
  return clean;
}

export function requiredText(value: unknown, field: string, rule: Omit<TextRule, 'required'>): string {
  return text(value, field, { ...rule, required: true })!;
}

interface IntRule {
  min: number;
  max: number;
  required?: boolean;
}

/** A whole number in a range. Strings are refused: the site sends numbers. */
export function int(value: unknown, field: string, rule: IntRule): number | null {
  if (value === undefined || value === null || value === '') {
    if (rule.required) throw bad('field_required', `${field} is required.`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) throw bad('bad_field', `${field} must be a whole number.`);
  if (value < rule.min || value > rule.max) throw bad('out_of_range', `${field} must be between ${rule.min} and ${rule.max}.`);
  return value;
}

export function requiredInt(value: unknown, field: string, rule: Omit<IntRule, 'required'>): number {
  return int(value, field, { ...rule, required: true })!;
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw bad('bad_field', `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** A list of short strings, each checked like a text field, de-duplicated (case-insensitive). */
export function stringList(value: unknown, field: string, rule: { maxItems: number; maxLength: number }): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad('bad_field', `${field} must be a list.`);
  if (value.length > rule.maxItems) throw bad('too_many', `${field}: at most ${rule.maxItems} items.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const clean = text(item, field, { max: rule.maxLength });
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

/** A query parameter from a whitelist; anything else falls back to the default. */
export function queryOneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A non-negative whole number from a query string, or null. */
export function queryInt(value: string | undefined, max = 1_000_000_000): number | null {
  if (value === undefined || value === '' || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n <= max ? n : null;
}

/** A short free-text query parameter (search), or null. */
export function queryText(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const clean = value.replace(CONTROL, '').replace(LINE_BREAKS, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

/** A numeric id from the path. Anything else is "not found", never a database query. */
export function idParam(raw: string | undefined): number {
  if (!raw || !/^\d{1,15}$/.test(raw)) throw bad('not_found', 'Not found.', 404);
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw bad('not_found', 'Not found.', 404);
  return id;
}

/** A task id from the path: the slug shape we create, or the ids in content/seed.json. */
export function taskIdParam(raw: string | undefined): string {
  if (!raw || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw)) throw bad('not_found', 'Not found.', 404);
  return raw;
}

export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
}

export function pageParams(c: Context, defaultSize = 25): PageParams {
  const page = Math.max(1, Math.min(queryInt(c.req.query('page'), 100_000) ?? 1, 100_000));
  const requested = queryInt(c.req.query('pageSize'), 100);
  const pageSize = requested && requested >= 10 ? requested : defaultSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Escapes a LIKE pattern so the team's search text is matched literally. Use with ESCAPE '\'. */
export const likePattern = (value: string): string => `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** JSON from our own columns. A broken value means "nothing", never a crash. */
export function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
