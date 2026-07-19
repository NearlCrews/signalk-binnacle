import { isFiniteNumber, readBoundedJson, withTimeout } from '$shared/lib';
import { asKeyedObject, authInit, str } from './resource';

// A symbol provided by a symbols resource provider (signalk-symbol-manager). The provider API
// is pre-1.0 and may churn; its shape is tracked by the weekly watch, so adjust here first.
// Aliases are `namespace:id` (namespace never `default`, id never containing a colon), `url` is
// the server-relative SVG asset, `scale` and `anchor` follow the OpenLayers convention:
// displayed size = SVG size x scale, anchor = [x, y] in source pixels from the top-left.
export interface SkSymbol {
  uuid: string;
  aliases: string[];
  name: string;
  url: string;
  roles: string[];
  scale?: number;
  anchor?: [number, number];
}

const SYMBOLS_PATH = '/signalk/v2/api/resources/symbols';
const ALIAS_PATTERN = /^[A-Za-z0-9_-]+:[^:]+$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_ROLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_SYMBOLS = 2_000;
const MAX_CATALOG_ENTRIES = 10_000;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_ALIASES = 32;
const MAX_ALIAS_LENGTH = 256;
const MAX_ROLES = 32;
const MAX_NAME_LENGTH = 160;
const MAX_URL_LENGTH = 2_048;
const MIN_SCALE = 0.01;
const MAX_SCALE = 16;
const MAX_ANCHOR_COORDINATE = 4_096;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function containsWhitespaceOrControl(value: string): boolean {
  return /\s/u.test(value) || containsControlCharacter(value);
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

function safeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= MAX_NAME_LENGTH &&
    !containsControlCharacter(trimmed)
    ? trimmed
    : fallback;
}

// Symbol assets must stay on the Signal K server. Allowing a provider-controlled absolute or
// protocol-relative URL would attach the device bearer token to another origin in SymbolsStore.
function safeAssetPath(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    containsWhitespaceOrControl(value)
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(value, 'http://binnacle.invalid');
    return parsed.origin === 'http://binnacle.invalid' && parsed.hash === '' ? value : undefined;
  } catch {
    return undefined;
  }
}

function aliasesFromEntry(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ALIASES) return undefined;
  // `default:` is reserved for the consumer's built-ins, so a provider alias claiming it is
  // dropped rather than allowed to shadow them.
  const aliases = value.filter(
    (alias): alias is string =>
      typeof alias === 'string' &&
      alias.length <= MAX_ALIAS_LENGTH &&
      !containsWhitespaceOrControl(alias) &&
      ALIAS_PATTERN.test(alias) &&
      !alias.startsWith('default:'),
  );
  const unique = [...new Set(aliases)];
  return unique.length > 0 ? unique : undefined;
}

function rolesFromEntry(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ROLES) return undefined;
  const roles: string[] = [];
  for (const role of value) {
    if (typeof role !== 'string' || !SAFE_ROLE_PATTERN.test(role)) return undefined;
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}

function anchorFromEntry(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [x, y] = value;
  return isFiniteNumber(x) &&
    x >= 0 &&
    x <= MAX_ANCHOR_COORDINATE &&
    isFiniteNumber(y) &&
    y >= 0 &&
    y <= MAX_ANCHOR_COORDINATE
    ? [x, y]
    : undefined;
}

function symbolFromEntry(id: string, raw: unknown): SkSymbol | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as {
    uuid?: unknown;
    alias?: unknown;
    name?: unknown;
    mediaType?: unknown;
    url?: unknown;
    roles?: unknown;
    scale?: unknown;
    anchor?: unknown;
  };
  // The rasterization pipeline decodes SVG text only, so other media types are skipped.
  if (str(entry.mediaType) !== 'image/svg+xml') return undefined;
  const uuid = entry.uuid === undefined ? safeId(id) : safeId(entry.uuid);
  const aliases = aliasesFromEntry(entry.alias);
  const url = safeAssetPath(entry.url);
  const roles = rolesFromEntry(entry.roles);
  if (!uuid || !aliases || !url || !roles) return undefined;
  return {
    uuid,
    aliases,
    name: safeName(entry.name, uuid),
    url,
    roles,
    scale:
      isFiniteNumber(entry.scale) && entry.scale >= MIN_SCALE && entry.scale <= MAX_SCALE
        ? entry.scale
        : undefined,
    anchor: anchorFromEntry(entry.anchor),
  };
}

// Fetch the provided symbols. A 404 (a stock server without a symbols provider) resolves to an
// empty list, same as a reachable provider with none configured; undefined is reserved for a
// genuine transport failure. Either way callers keep their built-in icons.
export async function fetchSymbols(base: string, token?: string): Promise<SkSymbol[] | undefined> {
  const url = `${base}${SYMBOLS_PATH}`;
  try {
    const response = await fetch(url, withTimeout(authInit(token)));
    if (response.status === 404) return [];
    if (!response.ok) {
      console.warn(`[symbols] ${url} returned ${response.status}`);
      return undefined;
    }
    const keyed = asKeyedObject(await readBoundedJson<unknown>(response, MAX_CATALOG_BYTES));
    if (!keyed) return undefined;
    const symbols: SkSymbol[] = [];
    const seenUuids = new Set<string>();
    let visited = 0;
    for (const id in keyed) {
      if (!Object.hasOwn(keyed, id) || visited >= MAX_CATALOG_ENTRIES) break;
      visited += 1;
      const symbol = symbolFromEntry(id, keyed[id]);
      if (!symbol || seenUuids.has(symbol.uuid)) continue;
      seenUuids.add(symbol.uuid);
      symbols.push(symbol);
      if (symbols.length >= MAX_SYMBOLS) break;
    }
    return symbols;
  } catch {
    return undefined;
  }
}
