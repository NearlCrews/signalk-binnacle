import type { Map as MapLibreMap } from 'maplibre-gl';
import { type MapThemePaint, mapThemePaint, setMapImage } from '$shared/map';
import type { SkSymbol } from '$shared/signalk';
import { anchorOffset, type RasterizeSymbol, SYMBOL_PIXEL_RATIO } from './symbol-raster';

export function symbolIconId(uuid: string): string {
  return `binnacle-symbol-${uuid}`;
}

export type SymbolIconStatus = 'loading' | 'ready' | 'failed';

export interface SymbolIconEntry {
  iconId: string;
  // The icon-offset that pins the symbol's declared anchor pixel to the geographic point.
  offset: [number, number];
}

// What the registry needs from the SymbolsStore, kept structural so this module does not
// import the store back (the store constructs registries).
interface SymbolAssets {
  rasterize: RasterizeSymbol;
  svgText(symbol: SkSymbol): Promise<string | undefined>;
  readonly revision?: number;
}

type SymbolIconState =
  | { status: 'loading'; symbol: SkSymbol; promise: Promise<boolean> }
  | { status: 'ready'; symbol: SkSymbol; entry: SymbolIconEntry }
  | { status: 'failed' };

// Loads, rasterizes, and registers provided symbols as map images, one registry per overlay.
// A symbol that fails to load or rasterize is marked failed for the session so the overlay
// degrades to its built-in icon without warnings and without hammering the provider.
export class SymbolIconRegistry {
  readonly #states = new Map<string, SymbolIconState>();
  #paint: MapThemePaint = mapThemePaint('day');
  readonly #assets: SymbolAssets;
  #revision: number;
  #lifecycle = 0;

  constructor(assets: SymbolAssets) {
    this.#assets = assets;
    this.#revision = assets.revision ?? 0;
  }

  entry(uuid: string): SymbolIconEntry | undefined {
    this.#syncRevision();
    const state = this.#states.get(uuid);
    return state?.status === 'ready' ? state.entry : undefined;
  }

  status(uuid: string): SymbolIconStatus | undefined {
    this.#syncRevision();
    return this.#states.get(uuid)?.status;
  }

  // Cancel deferred loads before an overlay is removed or its style is replaced. A later ensure
  // starts cleanly in the new lifecycle, while work from the old map can no longer register images.
  invalidate(): void {
    this.#clearStates();
  }

  // Register the symbol's image for the given paint, resolving true once it is usable. Safe to
  // call repeatedly: concurrent callers share one load, and a ready symbol whose image survived
  // is a no-op. A ready symbol whose image is gone (a base-style swap drops all images) reloads
  // from the cached SVG text.
  ensure(map: MapLibreMap, symbol: SkSymbol, paint: MapThemePaint): Promise<boolean> {
    this.#syncRevision();
    this.#paint = paint;
    const state = this.#states.get(symbol.uuid);
    if (state?.status === 'failed') return Promise.resolve(false);
    if (state?.status === 'loading') return state.promise;
    if (state?.status === 'ready' && map.hasImage(symbolIconId(symbol.uuid))) {
      return Promise.resolve(true);
    }
    const promise = this.#load(map, symbol, this.#lifecycle);
    this.#states.set(symbol.uuid, { status: 'loading', symbol, promise });
    return promise;
  }

  // Re-rasterize every registered symbol for a theme change (the night-red pixel pass applies
  // or lifts here). A refresh that fails keeps the previous image rather than dropping to a
  // missing icon mid-session.
  retheme(map: MapLibreMap, paint: MapThemePaint): void {
    this.#syncRevision();
    this.#paint = paint;
    const lifecycle = this.#lifecycle;
    for (const state of this.#states.values()) {
      if (state.status === 'ready')
        void this.#refresh(map, state.symbol, this.#revision, lifecycle);
    }
  }

  #warnedDegrade = false;

  async #load(map: MapLibreMap, symbol: SkSymbol, lifecycle: number): Promise<boolean> {
    const revision = this.#revision;
    const ok = await this.#refresh(map, symbol, revision, lifecycle);
    if (!this.#isCurrent(revision, lifecycle)) return false;
    if (!ok) {
      this.#states.set(symbol.uuid, { status: 'failed' });
      // Per-symbol degrade to the built-in icon is by design; a SYSTEMATIC failure (every asset
      // 401ing) must be diagnosable, so the first one logs once per registry.
      if (!this.#warnedDegrade) {
        this.#warnedDegrade = true;
        console.info(
          '[symbols] a provided symbol failed to load; built-in icons are used where that happens',
        );
      }
    }
    return ok;
  }

  async #refresh(
    map: MapLibreMap,
    symbol: SkSymbol,
    revision = this.#revision,
    lifecycle = this.#lifecycle,
  ): Promise<boolean> {
    const svg = await this.#assets.svgText(symbol);
    if (!svg || !this.#isCurrent(revision, lifecycle)) return false;
    const paint = this.#paint;
    const raster = await this.#assets.rasterize(svg, symbol.scale ?? 1, paint);
    if (!raster || !this.#isCurrent(revision, lifecycle)) return false;
    const iconId = symbolIconId(symbol.uuid);
    setMapImage(map, iconId, raster.image, SYMBOL_PIXEL_RATIO);
    this.#states.set(symbol.uuid, {
      status: 'ready',
      symbol,
      entry: {
        iconId,
        offset: anchorOffset(raster.cssWidth, raster.cssHeight, raster.scale, symbol.anchor),
      },
    });
    // The theme changed while this raster was in flight; redo it so a stale-theme bitmap
    // never sticks until the next theme change.
    if (paint.theme !== this.#paint.theme) {
      return this.#refresh(map, symbol, revision, lifecycle);
    }
    return true;
  }

  #isCurrent(revision: number, lifecycle: number): boolean {
    return (
      lifecycle === this.#lifecycle &&
      revision === this.#revision &&
      revision === (this.#assets.revision ?? 0)
    );
  }

  #clearStates(): void {
    this.#lifecycle += 1;
    this.#states.clear();
    this.#warnedDegrade = false;
  }

  #syncRevision(): void {
    const revision = this.#assets.revision ?? 0;
    if (revision === this.#revision) return;
    this.#revision = revision;
    this.#clearStates();
  }
}
