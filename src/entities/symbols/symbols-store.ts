import type { SkSymbol } from '$shared/signalk';
import { SymbolIconRegistry } from './icon-registry';
import { type RasterizeSymbol, rasterizeSymbolSvg } from './symbol-raster';

// Binnacle's own vendor namespace, the user-symbol namespace, and the reserved built-in namespace.
// Rendering and offering are split: a stored reference in ANY namespace renders as named (the
// symbol image is shared across apps), while the host built-in table and the icon pickers stay
// scoped. The host built-in table IS the `binnacle:` namespace in the shared library, so a bare id
// and an explicit `default:<id>` both resolve to `binnacle:<id>`. The pickers offer only `binnacle`
// and `custom` symbols. See the Symbols API resolution rules.
const BINNACLE_NS = 'binnacle';
const CUSTOM_NS = 'custom';
const DEFAULT_NS = 'default';
const MAX_SVG_BYTES = 256 * 1024;
const SVG_TIMEOUT_MS = 5000;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const FORBIDDEN_ELEMENT_NAMES = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'audio',
  'discard',
  'embed',
  'feimage',
  'foreignobject',
  'iframe',
  'image',
  'link',
  'object',
  'script',
  'set',
  'video',
]);

function safeCss(value: string): boolean {
  if (/\b(?:javascript|data):/iu.test(value) || /@import/iu.test(value) || value.includes('\\')) {
    return false;
  }
  for (const match of value.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/giu)) {
    if (!match[1].startsWith('#')) return false;
  }
  return true;
}

// Node-based unit tests do not provide DOMParser. Keep a conservative fallback there, while browser
// execution uses the namespace-aware XML parser below before any decoder sees provider content.
function safeSvgWithoutDomParser(text: string): boolean {
  const prefix = '(?:[A-Za-z_][A-Za-z0-9_.-]*:)?';
  if (!new RegExp(String.raw`<${prefix}svg(?:\s|/?>)`, 'iu').test(text)) return false;
  const forbidden = [...FORBIDDEN_ELEMENT_NAMES].join('|');
  if (new RegExp(String.raw`<${prefix}(?:${forbidden})\b`, 'iu').test(text)) return false;
  if (/\s(?:[A-Za-z_][A-Za-z0-9_.-]*:)?on[a-z]+\s*=/iu.test(text)) return false;
  if (/\b(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:href|src)\s*=\s*(?!["'])/iu.test(text)) return false;
  if (/\b(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:href|src)\s*=\s*["'](?!#)[^"']*["']/iu.test(text)) {
    return false;
  }
  return safeCss(text);
}

function safeSvg(text: string): boolean {
  if (/<!DOCTYPE|<!ENTITY|<\?|<!\[CDATA\[/iu.test(text) || !safeCss(text)) return false;
  if (typeof DOMParser === 'undefined') return safeSvgWithoutDomParser(text);

  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (document.getElementsByTagName('parsererror').length > 0) return false;
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) return false;
  for (const element of document.getElementsByTagName('*')) {
    const localName = element.localName.toLowerCase();
    if (FORBIDDEN_ELEMENT_NAMES.has(localName)) return false;
    for (const attribute of element.attributes) {
      const attributeName = attribute.localName.toLowerCase();
      const value = attribute.value.trim();
      if (attributeName.startsWith('on')) return false;
      if ((attributeName === 'href' || attributeName === 'src') && !value.startsWith('#')) {
        return false;
      }
      if (!safeCss(value)) return false;
    }
  }
  return true;
}

async function boundedText(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_SVG_BYTES) return undefined;
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= MAX_SVG_BYTES ? text : undefined;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SVG_BYTES) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

// The fetched symbol set with alias and role lookup. Constructed only when the symbols
// resource type answered (fetchSymbols returned a list); on a stock server no store exists and
// every consumer keeps its built-in icons. Also loads and caches the symbols' SVG asset text,
// shared across the per-overlay icon registries so a symbol both features use fetches once.
export class SymbolsStore {
  #symbols: readonly SkSymbol[] = [];
  readonly rasterize: RasterizeSymbol;
  readonly #base: string;
  #token: string | undefined;
  // Every alias of every namespace, so a reference stored by any app renders as named.
  readonly #byRef = new Map<string, SkSymbol>();
  // Symbols carrying at least one adopted (binnacle/custom) alias, for the role-filtered pickers.
  #adopted: readonly SkSymbol[] = [];
  readonly #svgTexts = new Map<string, Promise<string | undefined>>();

  constructor(
    base: string,
    token: string | undefined,
    symbols: readonly SkSymbol[] = [],
    rasterize: RasterizeSymbol = rasterizeSymbolSvg,
  ) {
    this.#base = base;
    this.#token = token;
    this.rasterize = rasterize;
    this.setSymbols(symbols);
  }

  // The asset fetches authenticate with whatever token is current; set when access resolves,
  // since the store is constructed before auth for the same reason setSymbols exists.
  setAuth(token: string | undefined): void {
    this.#token = token;
  }

  // Replace the symbol set. The store is constructed empty before auth resolves (the chart mounts
  // immediately; the symbols fetch needs credentials), then filled when the fetch lands, so the
  // overlays hold one stable store reference and resolve against whatever is known at render time.
  setSymbols(symbols: readonly SkSymbol[]): void {
    this.#svgTexts.clear();
    this.#byRef.clear();
    const adopted: SkSymbol[] = [];
    const unique: SkSymbol[] = [];
    const seenUuids = new Set<string>();
    for (const symbol of symbols) {
      if (seenUuids.has(symbol.uuid)) continue;
      seenUuids.add(symbol.uuid);
      unique.push(symbol);
      let isAdopted = false;
      for (const alias of symbol.aliases) {
        // Index every alias of every namespace. A reference another app stored (fsk:dive-site, a
        // plugin's my-plugin:icon, ...) must render as named: the image is shared, and only the
        // host built-in table and the pickers are namespace-scoped. `namespace:id` is globally
        // unique per the spec, so first-wins is enough.
        if (!this.#byRef.has(alias)) this.#byRef.set(alias, symbol);
        const colon = alias.indexOf(':');
        const namespace = colon === -1 ? '' : alias.slice(0, colon);
        if (namespace === BINNACLE_NS || namespace === CUSTOM_NS) isAdopted = true;
      }
      if (isAdopted) adopted.push(symbol);
    }
    this.#symbols = unique;
    this.#adopted = adopted;
  }

  // Resolve a stored symbol reference. A qualified `namespace:id` (in ANY namespace) matches the
  // symbol carrying that exact alias and renders as named, with no substitution when absent. A
  // bare id and an explicit `default:<id>` both resolve within the host built-in table, which is
  // the `binnacle:` namespace, so a Binnacle waypoint icon survives even when another app stored
  // `default:dive-site`. A declared role list must include the requested role; a symbol declaring
  // no roles claims nothing, so it is not excluded from any.
  resolve(idOrAlias: string, role?: string): SkSymbol | undefined {
    const symbol = this.#lookup(idOrAlias);
    if (!symbol) return undefined;
    if (role && symbol.roles.length > 0 && !symbol.roles.includes(role)) return undefined;
    return symbol;
  }

  get symbols(): readonly SkSymbol[] {
    return this.#symbols;
  }

  // Adopted symbols (binnacle/custom) declaring the given role, for the icon pickers.
  forRole(role: string): SkSymbol[] {
    return this.#adopted.filter((symbol) => symbol.roles.includes(role));
  }

  createIconRegistry(): SymbolIconRegistry {
    return new SymbolIconRegistry(this);
  }

  // The symbol's SVG text, fetched once per uuid and cached (theme re-rasters reuse it). The
  // The provider contract supplies a server-relative URL. Resolve it against the configured Signal K
  // origin and refuse any other origin before attaching the device token.
  svgText(symbol: SkSymbol): Promise<string | undefined> {
    const cached = this.#svgTexts.get(symbol.uuid);
    if (cached) return cached;
    const loading = this.#loadSvgText(symbol.url);
    this.#svgTexts.set(symbol.uuid, loading);
    // A transient failure (an expired token, a flaky link) must not be negative-cached for the
    // session: dropping the entry lets the next consumer retry, while a success stays cached.
    void loading
      .then((text) => {
        // Guard on identity: a setSymbols() clear plus a re-load for the same uuid may have replaced
        // this promise, and an unconditional delete would evict the newer entry and force a refetch.
        if (text === undefined && this.#svgTexts.get(symbol.uuid) === loading) {
          this.#svgTexts.delete(symbol.uuid);
        }
      })
      .catch(() => {
        if (this.#svgTexts.get(symbol.uuid) === loading) this.#svgTexts.delete(symbol.uuid);
      });
    return loading;
  }

  async #loadSvgText(assetPath: string): Promise<string | undefined> {
    try {
      const origin = new URL(this.#base).origin;
      const url = new URL(assetPath, `${origin}/`);
      if (url.origin !== origin || !assetPath.startsWith('/') || assetPath.startsWith('//')) {
        return undefined;
      }
      const headers = this.#token ? { Authorization: `Bearer ${this.#token}` } : undefined;
      const response = await fetch(url.href, {
        headers,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(SVG_TIMEOUT_MS),
      });
      if (!response.ok) return undefined;
      const finalUrl = response.url ? new URL(response.url) : url;
      if (finalUrl.origin !== origin) return undefined;
      const mediaType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
      if (mediaType !== 'image/svg+xml') return undefined;
      const text = await boundedText(response);
      return text && safeSvg(text) ? text : undefined;
    } catch {
      return undefined;
    }
  }

  #lookup(idOrAlias: string): SkSymbol | undefined {
    const colon = idOrAlias.indexOf(':');
    // Bare id: the host built-in table is the `binnacle:` namespace.
    if (colon === -1) return this.#byRef.get(`${BINNACLE_NS}:${idOrAlias}`);
    const namespace = idOrAlias.slice(0, colon);
    // Explicit built-in: the host table only, never a provider override the user rejected.
    if (namespace === DEFAULT_NS) {
      return this.#byRef.get(`${BINNACLE_NS}:${idOrAlias.slice(colon + 1)}`);
    }
    // Any other qualified alias renders as named when present in the shared library.
    return this.#byRef.get(idOrAlias);
  }
}
