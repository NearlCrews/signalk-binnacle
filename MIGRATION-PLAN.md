# MapLibre GL JS v6 Migration Plan

## Status Summary

| Item | Current | Target | Notes |
|------|---------|--------|-------|
| maplibre-gl | ^5.24.0 | ^6.0.0 | v6 is **pre-release** (latest: `6.0.0-20`). Stable not yet released. |
| terra-draw-maplibre-gl-adapter | ^1.4.1 | ^1.4.1 (likely) | Peer dep `maplibre-gl: >=4`. Open issue #912 for v6 support. No breaking API usage found. |
| terra-draw | ^1.31.0 | ^1.31.0 (likely) | No direct maplibre-gl dependency. |
| pmtiles | ^4.4.1 | ^4.4.1 | No maplibre-gl dependency. Uses `addProtocol` which is unchanged. |

**Recommendation:** Wait for maplibre-gl v6 stable release before merging. The pre-release API is still
changing (e.g., `Map` composition refactor landed in `6.0.0-20`). However, most code changes can be
prepared now and validated against pre-releases.

---

## Breaking Changes Affecting This Project

### 1. ESM-Only Distribution — Default Import Removal (6.0.0-5, PR #6254)

**Severity: HIGH** — Build will fail without changes.

The UMD bundle and default export are removed. All `import maplibregl from 'maplibre-gl'` (default
import) usages must change to namespace or named imports.

#### Files to change (4 production files + 1 test):

| File | Current | New |
|------|---------|-----|
| `src/shared/map/themed-map.ts` | `import maplibregl from 'maplibre-gl'` | `import * as maplibregl from 'maplibre-gl'` |
| `src/shared/map/pmtiles.ts` | `import maplibregl from 'maplibre-gl'` | `import * as maplibregl from 'maplibre-gl'` |
| `src/shared/map/overlay-tick.ts` | `import type maplibregl from 'maplibre-gl'` | `import type * as maplibregl from 'maplibre-gl'` |
| `src/shared/map/long-press.ts` | `import type maplibregl from 'maplibre-gl'` | `import type * as maplibregl from 'maplibre-gl'` |
| `src/features/marine-radar/ppi-layer.ts` | `import maplibregl from 'maplibre-gl'` | `import * as maplibregl from 'maplibre-gl'` |

**Note:** Type-only imports (`import type { Map as MapLibreMap } from 'maplibre-gl'`) used in ~30 files
are unaffected — named type imports work the same way in ESM-only.

#### Usage sites to verify:

- `new maplibregl.Map({...})` in `themed-map.ts:86` — works with namespace import.
- `maplibregl.addProtocol('pmtiles', protocol.tile)` in `pmtiles.ts:125` — works with namespace import.
- `maplibregl.MercatorCoordinate.fromLngLat(...)` in `ppi-layer.ts:175` — works with namespace import.

### 2. Event System Overhaul (6.0.0-17, PR #7789)

**Severity: MEDIUM** — TypeScript type changes; runtime behavior largely compatible.

#### Changes:
- `MapDataEvent` type removed → use `MapSourceDataEvent | MapStyleDataEvent`
- Events are now real classes, not plain objects — do **not** use `instanceof`, check `.type` field
- `MapLibreZoomEvent` renamed to `MapBoxZoomEvent`
- New `MapMovementEvent` type for `move`/`zoom`/`rotate`/`pitch`/`drag` events
- New events: `rollstart`/`roll`/`rollend`, `style.load`
- `Evented` is now generic and abstract

#### Affected code:

| File | Usage | Risk |
|------|-------|------|
| `src/shared/map/chart-overlay.ts` | `MapSourceDataEvent` type import | Type may need verification; likely unchanged as a type name |
| `src/features/anchor-watch/anchor-overlay.ts` | `MapLayerMouseEvent`, `MapLayerTouchEvent`, `MapMouseEvent`, `MapTouchEvent` types | Type names need verification — may be renamed or restructured |
| `src/features/notes/notes-hit-handlers.ts` | `MapLayerMouseEvent` type | Same as above |
| `src/shared/map/themed-map.ts` | Event handler signatures (`.on('click', ...)`, `.on('move', ...)`, etc.) | The event parameter types may change; inline destructuring (`e.lngLat`) should still work |

**Action:** After upgrading, run `svelte-check` / `tsc` and fix any type errors in event handler
signatures. The runtime behavior of `.on()` / `.off()` is unchanged.

### 3. GeoJSONSource.setData API Change (6.0.0-3, PR #7538)

**Severity: LOW** — We don't use the removed features.

- Second parameter `waitForCompletion` removed
- Return value removed (was `this` for chaining)

**Our usage** (via `setSourceData` in `overlay-helpers.ts:27`):
```ts
(map.getSource(sourceId) as GeoJSONSource | undefined)?.setData(data);
```
This uses no second parameter and doesn't chain the return value. **No change needed.**

### 4. zoomLevelsToOverscale Default Changed (6.0.0-4, PR #7537)

**Severity: MEDIUM** — Behavioral change, may affect rendering and hit-testing.

Default changed from `undefined` to `4`. This means at high zoom levels, vector tiles are now sliced
instead of overscaled. Affects:
- `queryRenderedFeatures` results (used in `working-route-overlay.ts:174`)
- Rendering of polygon center labels
- Vector tile rendering at high zoom

**Mitigation:** To preserve v5 behavior during migration, set in Map constructor options:
```ts
new maplibregl.Map({
  ...,
  zoomLevelsToOverscale: undefined,  // restore v5 behavior
});
```
Then evaluate whether the new default (4) produces acceptable results.

### 5. Map No Longer Extends Camera — Composition (6.0.0-20, PR #7800)

**Severity: LOW for us** — We don't access `map.transform`.

- `Map` now composes `Camera` instead of extending it
- `map.transform` property removed
- Internal `transform.getMatrixForModel` removed

**Our usage:** We do **not** access `map.transform` anywhere. The custom layers
(`ppi-layer.ts`, `wind-overlay.ts`) receive the projection matrix via the render args object, not
through `map.transform`. **No change needed.**

### 6. Custom Layer Render Args (6.0.0-1)

**Severity: LOW-MEDIUM** — Need to verify the render-args shape.

Our `custom-layer.ts` helper already handles the v5 render-args object shape:
```ts
export function matrixOf(args: unknown): number[] {
  if (Array.isArray(args)) return args;
  const data = (args as { defaultProjectionData?: { mainMatrix?: number[] } })
    .defaultProjectionData;
  return data?.mainMatrix ?? [];
}
```

v6 reportedly exposes `getProjectionData` in the custom layer args. The shape may have changed.
**Action:** Test custom layers (wind particles, radar echo) against v6 pre-release and verify
`matrixOf` still extracts the 4×4 projection matrix correctly. Update if the args shape changed.

### 7. Improved TypeScript Types for Layout/Paint Properties (6.0.0-1, PR #7481)

**Severity: MEDIUM** — Likely TypeScript errors, not runtime.

`setPaintProperty` and `setLayoutProperty` parameters changed from `string`/`any` to actual typed
properties. We have ~180 calls to these methods. Most pass literal strings like
`'visibility'`, `'fill-opacity'`, `'line-opacity'`, etc.

**Action:** Run `svelte-check` after upgrade. Fix any type errors by ensuring property names match
the typed specifications. Some casts may be needed for custom property names like
`'color-relief-color'` or `'color-relief-opacity'`.

### 8. Style Spec v25 (6.0.0-16, PR #7792)

**Severity: LOW-MEDIUM**

- Stricter legacy expression validation — our expressions use modern `['interpolate', ...]` syntax, should be fine
- `has` filter now returns `false` for `undefined` properties — check if any of our filters rely on `has` for undefined-but-present properties
- New paint properties `fill-layer-opacity` and `line-layer-opacity` — could simplify our opacity handling in the future
- New `encoding: 'mlt'` for vector sources — we use `'terrarium'` for raster-dem, not affected

### 9. Shader `#pragma mapbox` → `#pragma maplibre` (6.0.0-14, PR #7761)

**Severity: NONE for us**

Our custom shaders in `radar-gl.ts` and `wind-field-texture.ts` use `#version 300 es` GLSL with
**no** `#pragma mapbox` or `#pragma maplibre` directives. They are fully self-contained shader
programs. **No change needed.**

### 10. WebGL2 Required (6.0.0-2, PR #7453)

**Severity: LOW** — Modern browsers support WebGL2.

WebGL1 support dropped. All our custom WebGL code already uses WebGL2 (`WebGL2RenderingContext`).
Error handling refactored — listen to `.on("error")` or override `Map._showWebGL2Error`.
Our `themed-map.ts` already listens to `'error'`. **No change needed.**

### 11. TypeScript Target ES2022 (6.0.0-3, PR #7404)

**Severity: NONE**

Our project uses TypeScript 6.x and Vite 8.x, already targeting modern environments. **No change needed.**

---

## Dependency Compatibility Assessment

### terra-draw-maplibre-gl-adapter (^1.4.1)

**Status: Likely compatible, needs testing.**

- Peer dependency: `maplibre-gl: >=4` (broad range, should accept v6)
- Open issue [#912](https://github.com/JamesLMilner/terra-draw/issues/912) requesting v6 support (created 2026-06-11, no PR yet)
- API surface used by the adapter: `addLayer`, `addSource`, `removeLayer`, `removeSource`, `getSource` (cast to `GeoJSONSource`), `setData`, `getCanvas`, `getContainer`, `project`, `unproject`, `addImage`, `dragPan.isEnabled()`, `dragPan.disable()`, `dragPan.enable()`, `dragRotate.isEnabled()`, `dragRotate.disable()`, `dragRotate.enable()`
- **None of these APIs are removed or renamed in v6.**
- The adapter imports types (`CircleLayerSpecification`, `FillLayerSpecification`, `GeoJSONSource`, `LineLayerSpecification`, `Map as MaplibreMap`, `PointLike`) — these should still exist in v6

**Risk:** The adapter may have TypeScript type mismatches with v6's stricter types. Since it's a
dependency (not our code), we can't easily fix it. If the adapter fails to type-check, we may need to:
1. Use `npm override` or patch
2. Wait for a new adapter release
3. Fork and patch the adapter

**Our usage is limited to 2 files:**
- `src/features/route-edit/route-edit.ts` — route editing (linestring, point, select modes)
- `src/features/prewarm/regions-draw.ts` — region rectangle drawing

### pmtiles (^4.4.1)

**Status: Fully compatible.**

- No dependency on maplibre-gl (only depends on `fflate`)
- The `Protocol` class and `protocol.tile` function are framework-agnostic
- Our usage calls `maplibregl.addProtocol('pmtiles', protocol.tile)` — `addProtocol` is unchanged in v6
- `PMTiles`, `Protocol`, `RangeResponse`, `Source` types from pmtiles are independent of maplibre-gl
- **No change needed.**

### terra-draw (^1.31.0)

**Status: Fully compatible.**

- No direct dependency on maplibre-gl at all
- The core drawing library works with any adapter
- **No change needed.**

---

## Migration Steps

### Phase 1: Preparation (can do now, no v6 needed)

1. **Audit `setData` usage** — Confirm no code chains `setData` return value or uses `waitForCompletion` (✅ confirmed: no such usage)
2. **Audit `map.transform` usage** — Confirm no code accesses the internal transform property (✅ confirmed: no such usage)
3. **Document event handler types** — List all event handler signatures that may need type updates

### Phase 2: Code Changes (against v6 pre-release or stable)

1. **Change default imports to namespace imports** (5 files):
   ```ts
   // BEFORE: import maplibregl from 'maplibre-gl'
   // AFTER:  import * as maplibregl from 'maplibre-gl'
   ```
   - `src/shared/map/themed-map.ts`
   - `src/shared/map/pmtiles.ts`
   - `src/shared/map/overlay-tick.ts`
   - `src/shared/map/long-press.ts`
   - `src/features/marine-radar/ppi-layer.ts`

2. **Update package.json**:
   ```json
   "maplibre-gl": "^6.0.0"
   ```
   Keep `terra-draw-maplibre-gl-adapter`, `terra-draw`, and `pmtiles` at current versions.

3. **Update CSS import path** in `src/app.css:5`:
   ```css
   /* BEFORE: @import "maplibre-gl/dist/maplibre-gl.css"; */
   /* AFTER:  @import "maplibre-gl/dist/maplibre-gl.css"; */
   ```
   (Verify the CSS file path hasn't changed in the ESM-only distribution.)

4. **Add `zoomLevelsToOverscale` to Map constructor** (temporary, for behavioral parity):
   ```ts
   new maplibre.Map({
     ...,
     zoomLevelsToOverscale: undefined,  // restore v5 behavior during migration
   });
   ```
   in `src/shared/map/themed-map.ts:87`.

5. **Fix TypeScript type errors** — Run `svelte-check` and fix:
   - Event handler parameter types (anchor-overlay, notes-hit-handlers, themed-map)
   - `setPaintProperty` / `setLayoutProperty` parameter types
   - Any renamed or restructured type exports

6. **Update fake-map.ts** — Add/update any new API methods or changed signatures the test infrastructure needs to stub.

7. **Verify custom layer render args** — Test wind particle layer and radar echo layer. Update `custom-layer.ts:matrixOf` if the render-args shape changed.

### Phase 3: Testing

1. **Unit tests** — Run `vitest run` and fix any failures from type or API changes
2. **Type checking** — Run `svelte-check --tsconfig ./tsconfig.app.json`
3. **Lint** — Run `biome lint .`
4. **E2E** — Run `playwright test`
5. **Manual testing checklist:**
   - [ ] Map loads and renders base style
   - [ ] PMTiles charts load (both companion and remote)
   - [ ] Vector and raster overlays render
   - [ ] Route editing with Terra Draw works (add, edit, delete waypoints)
   - [ ] Region rectangle drawing works
   - [ ] Wind particle animation renders
   - [ ] Marine radar echo renders
   - [ ] AIS targets display and update
   - [ ] Anchor watch drag interaction works
   - [ ] Notes click/hover handlers work
   - [ ] Theme switch (day/dusk/night-red) recolors correctly
   - [ ] Layer visibility toggle and opacity work
   - [ ] Layer reordering works
   - [ ] Map fly-to animation works
   - [ ] Long-press context menu works
   - [ ] Offline fallback base style loads
   - [ ] `setGlobalStateProperty` for unit display works

### Phase 4: Polish (post-migration)

1. **Remove `zoomLevelsToOverscale: undefined`** if the new default (4) produces acceptable results
2. **Consider adopting new v6 features:**
   - `fill-layer-opacity` / `line-layer-opacity` for simpler layer-level opacity
   - `style.load` event (replaces `'load'` listener in `themed-map.ts`)
   - Strongly-typed events for better developer experience
3. **Update `custom-layer.ts` comment** — currently says "MapLibre 5 passes a render-args object"; update for v6

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| terra-draw adapter fails to type-check against v6 | Medium | High (blocks route editing) | Test early; fork/patch if needed; file issue upstream |
| Custom layer render-args shape changed | Low-Medium | High (breaks wind + radar) | Test early; `matrixOf` is isolated in one file |
| Event type changes cause widespread TS errors | Medium | Low (type-only fixes) | Run svelte-check, fix incrementally |
| `setPaintProperty` stricter types cause TS errors | Medium | Low (type-only fixes) | Add casts where needed |
| `zoomLevelsToOverscale` default changes rendering | Low | Low (visual) | Set to `undefined` temporarily |
| CSS file path changed in ESM-only dist | Low | Medium (build fails) | Verify path, update import |
| v6 stable release further changes API | Medium | Variable | Wait for stable before merging |

---

## File Change Summary

### Production code changes:
- `package.json` — bump maplibre-gl to ^6.0.0
- `src/app.css` — verify/update CSS import path
- `src/shared/map/themed-map.ts` — namespace import, zoomLevelsToOverscale option
- `src/shared/map/pmtiles.ts` — namespace import
- `src/shared/map/overlay-tick.ts` — namespace type import
- `src/shared/map/long-press.ts` — namespace type import
- `src/features/marine-radar/ppi-layer.ts` — namespace import
- `src/shared/map/custom-layer.ts` — verify/update render-args shape handling
- Various overlay files — event type fixes (as needed per svelte-check)
- Various overlay files — setPaintProperty/setLayoutProperty type fixes (as needed)

### Test code changes:
- `src/shared/testing/fake-map.ts` — add any new API stubs
- Various `.test.ts` files — fix type assertions as needed

### No changes needed:
- All `import type { Map as MapLibreMap } from 'maplibre-gl'` (~30 files) — named type imports work fine
- All `import type { ...Specification } from 'maplibre-gl'` (~20 files) — type-only imports unaffected
- Custom shader code — no `#pragma mapbox` usage
- pmtiles integration — `addProtocol` API unchanged
- terra-draw integration — adapter API surface unchanged (pending testing)

---

## Timing

**Earliest viable migration:** Once maplibre-gl v6.0.0 stable is released.

**Estimated effort:** 1-2 days of focused work for the code changes, plus testing time. The bulk of
the risk is in the terra-draw adapter compatibility and custom layer render-args verification.
