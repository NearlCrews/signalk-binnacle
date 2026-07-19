import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapThemePaint } from '$shared/map';
import type { SkSymbol } from '$shared/signalk';
import type { SymbolIconEntry } from './icon-registry';
import type { SymbolsStore } from './symbols-store';

export interface OverlayIconResolver<T> {
  // The registered icon for an item whose reference resolves to a provided symbol, or undefined for
  // the overlay's built-in icon (no symbols store, unresolvable reference, image still loading, or a
  // failed load). A resolvable-but-not-yet-registered symbol is queued for the next ensurePending.
  iconEntry(item: T): SymbolIconEntry | undefined;
  // Kick the loads the renders queued; each success runs onLoaded so the overlay redraws and the
  // now-registered symbol replaces its built-in icon. A failure is remembered by the registry, so
  // the built-in icon simply stays.
  ensurePending(map: MapLibreMap, paint: MapThemePaint, onLoaded: () => void): void;
  // Re-rasterize every registered provided symbol for a theme change.
  retheme(map: MapLibreMap, paint: MapThemePaint): void;
  // Cancel pending work before the owning overlay is removed or its base style is replaced.
  invalidate(): void;
}

// The provided-symbol icon-resolution glue shared by the imperative overlays (notes, waypoints):
// it owns the per-overlay icon registry and the pending-symbol queue, and resolves each item to a
// registered map image via the overlay's own resolveSymbol mapper. Absent symbols store yields no
// resolver work, so the overlay keeps its built-in icons.
export function createOverlayIconResolver<T>(
  symbols: SymbolsStore | undefined,
  resolveSymbol: (item: T) => SkSymbol | undefined,
): OverlayIconResolver<T> {
  // The registry holds the registered map images; pendingSymbols collects the
  // resolvable-but-not-yet-registered ones a render saw, so their loads are kicked once and the set
  // redrawn when they land.
  const registry = symbols?.createIconRegistry();
  const pendingSymbols = new Map<string, SkSymbol>();

  return {
    iconEntry(item) {
      if (!registry) return undefined;
      const symbol = resolveSymbol(item);
      if (!symbol) return undefined;
      const entry = registry.entry(symbol.uuid);
      if (entry) return entry;
      if (registry.status(symbol.uuid) !== 'failed') pendingSymbols.set(symbol.uuid, symbol);
      return undefined;
    },
    ensurePending(map, paint, onLoaded) {
      if (!registry || pendingSymbols.size === 0) return;
      const pending = [...pendingSymbols.values()];
      pendingSymbols.clear();
      for (const symbol of pending) {
        void registry
          .ensure(map, symbol, paint)
          .then((ok) => {
            if (ok) onLoaded();
          })
          // A rejected load behaves like a resolved false: the built-in icon stays.
          .catch(() => undefined);
      }
    },
    retheme(map, paint) {
      registry?.retheme(map, paint);
    },
    invalidate() {
      pendingSymbols.clear();
      registry?.invalidate();
    },
  };
}
