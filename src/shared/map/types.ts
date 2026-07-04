import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ChartGroup } from 'signalk-chart-sources';
import type { MapThemePaint } from './map-theme';

export type ZBand =
  | 'basemap'
  | 'bathymetry'
  | 'track'
  | 'weather'
  | 'routes'
  | 'safety'
  | 'traffic'
  | 'vessel'
  | 'overlay-top';

// Bottom-to-top band order. Two arrangements are deliberate. The weather band sits just above
// bathymetry and below every live overlay, so ocean fields (sea-surface temperature, sea ice) read
// as a background layer and the Layers panel's single Ocean section never splits the overlay
// sections. And the track and routes bands sit ABOVE safety and traffic, so the navigator's own
// routes and tracks draw over the AIS and reference overlays (still below the pinned own-vessel and
// collision rings), and the Layers panel can lead with "My routes and tracks" above "Traffic and
// live data".
export const Z_ORDER: readonly ZBand[] = [
  'basemap',
  'bathymetry',
  'weather',
  'safety',
  'traffic',
  'track',
  'routes',
  'vessel',
  'overlay-top',
] as const;

export interface OverlayContext {
  map: MapLibreMap;
  beforeIdFor(band: ZBand): string | undefined;
}

export interface OverlayModule {
  readonly id: string;
  readonly title: string;
  // A one-line plain-language gloss of what the overlay shows, surfaced as the Layers-panel row's
  // hover tooltip so a navigator new to charts can learn a layer without leaving the panel. Absent
  // for overlays whose title already says it plainly.
  readonly description?: string;
  readonly band: ZBand;
  // An optional parent overlay id. A sub-layer (for example the NOAA ENC data-quality overlay under
  // the NOAA ENC chart) nests under its parent in the Layers panel and is only shown when the parent
  // is on, so a facet never renders without the chart it annotates.
  readonly parent?: string;
  // An optional named group this overlay is a facet of. When two or more overlays share a group id,
  // the Layers panel renders one labeled group header above them and lists each as a facet under it,
  // so a multi-facet chart (the NOAA ENC chart plus its data-quality overlay) reads as one unit.
  // Generic: any future multi-facet source declares the same descriptor.
  readonly group?: Readonly<ChartGroup>;
  // The Layers-panel category this overlay belongs to, so the panel groups it without knowing any
  // feature id. When absent the panel derives a category from the band. The category vocabulary and
  // its order live in the panel; an overlay just declares which one it joins.
  readonly category?: string;
  // The geographic region a regional provider covers (US, EU, Global, and so on), shown as a small tag
  // on the Layers-panel row so a navigator sees at a glance which overlays apply to their waters. Absent
  // for the navigator's own data and live overlays, which are not region-specific.
  readonly region?: string;
  // When false the overlay is not shown as a Layers-panel row: it is a tool (Measure, Time travel)
  // controlled from the menu, not a layer the navigator toggles or reorders. It is still registered
  // and rendered. Absent means listed.
  readonly listed?: boolean;
  readonly supportsOpacity: boolean;
  // Initial visibility when there is no saved state. Defaults to visible; the reference and depth
  // overlays set this false so they start off until the navigator enables one for their area.
  readonly defaultVisible?: boolean;
  // Initial opacity when there is no saved state. Defaults to 1; the translucent weather fields set
  // this below 1 so the chart reads through them.
  readonly defaultOpacity?: number;
  // The MapLibre layer ids this overlay manages, bottom to top, so the LayerManager can
  // restack the whole overlay group when the user reorders layers.
  readonly layerIds: readonly string[];
  add(ctx: OverlayContext): void | Promise<void>;
  remove(ctx: OverlayContext): void;
  setVisible(ctx: OverlayContext, visible: boolean): void;
  setOpacity?(ctx: OverlayContext, opacity: number): void;
  reattach?(ctx: OverlayContext): void | Promise<void>;
  // Invalidate the overlay's change-detection cache so its next sync repopulates from scratch. The
  // manager calls this on a base-style swap, which recreates the overlay's sources empty: an overlay
  // that skips a sync when its data is unchanged implements this so it does not stay blank afterward,
  // instead of each one remembering to self-reset inside add().
  reset?(): void;
  applyTheme?(ctx: OverlayContext, paint: MapThemePaint): void;
  // A detect-and-degrade overlay declares its availability. When this returns false the Layers panel
  // shows the row grayed out, with unavailableHint as a hover tooltip, and disables its toggle, rather
  // than hiding the capability: the navigator sees that it exists and why it is inactive. Absent means
  // always available.
  readonly available?: () => boolean;
  // The tooltip shown on a grayed-out (unavailable) row, explaining what to install or enable.
  readonly unavailableHint?: string;
  // The row exposes a settings gear that asks the host to open this overlay's own controls, through
  // the panel's onManageLayer callback. The host owns the panel content, so the generic Layers panel
  // never imports a feature.
  readonly manageable?: boolean;
}
