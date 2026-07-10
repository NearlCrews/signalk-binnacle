import { isFiniteNumber } from '$shared/lib';
import { fetchKeyedResource, str, strArray } from './resource';

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

function aliasesFromEntry(value: unknown): string[] | undefined {
  // `default:` is reserved for the consumer's built-ins, so a provider alias claiming it is
  // dropped rather than allowed to shadow them.
  const aliases = strArray(value)?.filter(
    (alias) => ALIAS_PATTERN.test(alias) && !alias.startsWith('default:'),
  );
  return aliases && aliases.length > 0 ? aliases : undefined;
}

function anchorFromEntry(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [x, y] = value;
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : undefined;
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
  const aliases = aliasesFromEntry(entry.alias);
  const url = str(entry.url);
  if (!aliases || !url) return undefined;
  return {
    uuid: str(entry.uuid) ?? id,
    aliases,
    name: str(entry.name) ?? id,
    url,
    roles: strArray(entry.roles) ?? [],
    scale: isFiniteNumber(entry.scale) && entry.scale > 0 ? entry.scale : undefined,
    anchor: anchorFromEntry(entry.anchor),
  };
}

// Fetch the provided symbols. A 404 (a stock server without a symbols provider) resolves to an
// empty list, same as a reachable provider with none configured; undefined is reserved for a
// genuine transport failure. Either way callers keep their built-in icons.
export function fetchSymbols(base: string, token?: string): Promise<SkSymbol[] | undefined> {
  return fetchKeyedResource(base, [SYMBOLS_PATH], token, symbolFromEntry, (url, status) =>
    console.warn(`[symbols] ${url} returned ${status}`),
  );
}
