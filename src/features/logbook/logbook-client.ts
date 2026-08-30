import { clampInt, cleanBoundedText, isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import {
  authInit,
  cleanTruncatedText,
  mutationResultFor,
  type ResourceMutationResult,
  sendJson,
} from '$shared/signalk';

// The Logbook plugin (npm package @meri-imperiumi/signalk-logbook, plugin id "signalk-logbook")
// serves its REST API on the Signal K plugin mount /plugins/signalk-logbook, verified against the
// 0.12.0 tarball's plugin/index.js and schema/openapi.json: GET /logs answers the "YYYY-MM-DD"
// day strings that have entries, GET /logs/{date} answers that day's entries, and POST /logs with
// { text, category?, ago?, datetime?, observations?, vhf?, author?, origin? } appends one (201).
// Posting without a datetime snapshots the vessel's buffered navigation state into the entry
// server-side, so Binnacle sends only the text and category: the plugin owns the position,
// heading, speed, wind, and barometer capture. Entry numerics are the plugin's own display units
// (degrees, knots, hPa), not SI, so Binnacle reads only the datetime, text, category, author, and
// origin fields and never lets the rest near the store.
export const LOGBOOK_PLUGIN_ID = 'signalk-logbook';

export const MAX_LOGBOOK_TEXT_LENGTH = 2000;
export const MAX_RECENT_ENTRIES = 400;
const MAX_LOG_DAYS = 7;
const MAX_DATES_SCANNED = 4000;
const MAX_ENTRIES_PER_DAY = 200;
const MAX_AUTHOR_LENGTH = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const logsUrl = (origin: string) => `${origin}/plugins/${LOGBOOK_PLUGIN_ID}/logs`;

export type LogbookAvailability = 'available' | 'absent' | 'unauthorized' | 'error';

export type LogbookCategory = 'navigation' | 'engine' | 'radio' | 'maintenance';
export type LogbookOrigin = 'manual' | 'auto' | 'agent';

const CATEGORIES: readonly LogbookCategory[] = ['navigation', 'engine', 'radio', 'maintenance'];
const ORIGINS: readonly LogbookOrigin[] = ['manual', 'auto', 'agent'];

export interface LogbookEntry {
  datetime: string;
  timeMs: number;
  // Empty for the plugin's automatic hourly position entries, which carry text ''.
  text: string;
  category?: LogbookCategory;
  author?: string;
  origin?: LogbookOrigin;
}

export type LogbookEntriesResult =
  | { state: 'ok'; entries: LogbookEntry[] }
  | { state: 'absent' }
  | { state: 'unauthorized' }
  | { state: 'error' };

type ProbeResult =
  | { state: 'ok'; body: unknown }
  | { state: 'absent' }
  | { state: 'unauthorized' }
  | { state: 'error' };

// A 404 on the mount is the Signal K server's answer for a plugin that is not installed or not
// enabled, so it maps to absent rather than error.
async function getLogsJson(url: string, token: string | undefined): Promise<ProbeResult> {
  try {
    const response = await fetch(url, withTimeout(authInit(token)));
    if (response.status === 404) return { state: 'absent' };
    if (response.status === 401 || response.status === 403) return { state: 'unauthorized' };
    if (!response.ok) return { state: 'error' };
    return { state: 'ok', body: await readBoundedJson<unknown>(response) };
  } catch {
    return { state: 'error' };
  }
}

export async function detectLogbook(
  origin: string,
  token: string | undefined,
): Promise<LogbookAvailability> {
  const result = await getLogsJson(logsUrl(origin), token);
  return result.state === 'ok' ? 'available' : result.state;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function parseEntry(raw: unknown): LogbookEntry | undefined {
  if (!isRecord(raw) || typeof raw.datetime !== 'string') return undefined;
  const timeMs = Date.parse(raw.datetime);
  if (!Number.isFinite(timeMs)) return undefined;
  const category = oneOf(raw.category, CATEGORIES);
  const author = cleanTruncatedText(raw.author, MAX_AUTHOR_LENGTH);
  const entryOrigin = oneOf(raw.origin, ORIGINS);
  return {
    datetime: raw.datetime,
    timeMs,
    text: cleanTruncatedText(raw.text, MAX_LOGBOOK_TEXT_LENGTH) ?? '',
    ...(category ? { category } : {}),
    ...(author ? { author } : {}),
    ...(entryOrigin ? { origin: entryOrigin } : {}),
  };
}

// The newest `days` logged days (not calendar days), all entries merged newest first and bounded.
export async function fetchRecentEntries(
  origin: string,
  token: string | undefined,
  days = 2,
): Promise<LogbookEntriesResult> {
  const listed = await getLogsJson(logsUrl(origin), token);
  if (listed.state !== 'ok') return { state: listed.state };
  if (!Array.isArray(listed.body)) return { state: 'error' };
  const dates = listed.body
    .slice(0, MAX_DATES_SCANNED)
    .filter((value): value is string => typeof value === 'string' && DATE_PATTERN.test(value))
    .sort()
    .slice(-clampInt(days, 1, MAX_LOG_DAYS));
  const entries: LogbookEntry[] = [];
  for (const date of dates) {
    const day = await getLogsJson(`${logsUrl(origin)}/${date}`, token);
    // A day listed a moment ago can 404 when its file was just deleted; that is an empty day on a
    // reachable plugin, not a missing plugin.
    if (day.state === 'absent') continue;
    if (day.state !== 'ok') return { state: day.state };
    if (!Array.isArray(day.body)) return { state: 'error' };
    for (const raw of day.body.slice(0, MAX_ENTRIES_PER_DAY)) {
      const entry = parseEntry(raw);
      if (entry) entries.push(entry);
    }
  }
  entries.sort((a, b) => b.timeMs - a.timeMs);
  return { state: 'ok', entries: entries.slice(0, MAX_RECENT_ENTRIES) };
}

export interface CreateLogEntryOptions {
  category?: LogbookCategory;
}

// Routes through sendJson so the app-wide write-outcome listener observes a 401 or 403, which is
// how a read-only token reveals itself on a write.
export async function createLogEntry(
  origin: string,
  token: string | undefined,
  text: string,
  options?: CreateLogEntryOptions,
): Promise<ResourceMutationResult> {
  const cleaned = cleanBoundedText(text, MAX_LOGBOOK_TEXT_LENGTH);
  if (!cleaned) return 'failed';
  const body = {
    text: cleaned,
    ...(options?.category ? { category: options.category } : {}),
  };
  return mutationResultFor(await sendJson(logsUrl(origin), token, 'POST', body));
}
