import { validateRadarRect } from './radar-rect-model';
import { validateRadarSector } from './radar-sector-model';
import type {
  ControlDefinition,
  RadarAreaDraft,
  RadarControlEntry,
  RadarStructuredValue,
} from './radar-types';
import { validateRadarZone } from './radar-zone-model';

// Map a Signal K radar control definition to the widget that edits it: a boolean is a toggle, an enum is
// a select, and a number is a slider over its value. Unknown compound controls stay structured and
// read-only because their provider-defined properties cannot safely be inferred.
export function widgetKind(
  def: ControlDefinition,
): 'slider' | 'list' | 'toggle' | 'text' | 'button' | 'structured' {
  if (def.type === 'boolean') return 'toggle';
  if (def.type === 'enum') return 'list';
  if (def.type === 'string') return 'text';
  if (def.type === 'button') return 'button';
  if (
    def.type === 'sector' ||
    def.type === 'zone' ||
    def.type === 'rect' ||
    def.type === 'compound'
  )
    return 'structured';
  return 'slider';
}

// Capability readOnly is static. The live value's allowed flag is the Radar API's dynamic permission.
// Use one predicate in the panel and at the controller action boundary so controls cannot become
// writable merely because one of those checks was omitted.
export function controlWriteBlockReason(
  def: ControlDefinition | undefined,
  entry: RadarControlEntry | undefined,
  controlsForbidden: boolean,
): string | undefined {
  if (!def) return 'The radar did not report a capability for this control.';
  if (controlsForbidden) return 'Read-write radar access is required.';
  // A fallback definition is Binnacle's own, built from the controls discovery reported when the
  // provider serves no capabilities, so its read-only state is not something the radar said.
  if (def.dialect === 'fallback')
    return 'Control type information is not available for this provider.';
  if (def.readOnly) return 'The radar reports this control as read-only.';
  if (entry?.allowed === false)
    return 'The radar is not allowing changes to this control right now.';
  return undefined;
}

export function validateStructuredControl(
  definition: ControlDefinition | undefined,
  value: RadarStructuredValue,
): string | undefined {
  if (!definition) return 'The radar did not report this control.';
  if (definition.type === 'zone' && 'startDistance' in value)
    return validateRadarZone(definition, value);
  if (definition.type === 'sector' && 'value' in value && !('startDistance' in value))
    return validateRadarSector(definition, value);
  if (definition.type === 'rect' && 'x1' in value) return validateRadarRect(definition, value);
  return 'The structured value does not match this radar control.';
}

interface RadarAreaEditStore {
  selectedId: string | undefined;
  areaDraft: RadarAreaDraft | undefined;
  setAreaDraft(draft: RadarAreaDraft | undefined): void;
}

interface RadarAreaEditDeps {
  getCenter(): unknown;
  getHeading?(): number | undefined;
  centerFresh?(): boolean;
  headingFresh?(): boolean;
  chartEditBlockedReason?(): string | undefined;
}

export function startRadarAreaChartEdit(
  store: RadarAreaEditStore,
  deps: RadarAreaEditDeps,
  controlId: string,
): string | undefined {
  const draft = store.areaDraft;
  if (!draft || draft.controlId !== controlId || draft.radarId !== store.selectedId)
    return 'Start editing this radar area before placing it on the chart.';
  const blocked = deps.chartEditBlockedReason?.();
  if (blocked) return blocked;
  if (deps.centerFresh?.() === false || !deps.getCenter())
    return 'A fresh own-vessel position is needed for chart editing.';
  if (
    draft.type !== 'rect' &&
    (deps.headingFresh?.() === false || deps.getHeading?.() === undefined)
  ) {
    return 'A fresh true heading is needed for heading-relative radar geometry.';
  }
  store.setAreaDraft({ ...draft, chartEditing: true, chartStep: 0, chartError: undefined });
  return undefined;
}

export function stopRadarAreaChartEdit(store: RadarAreaEditStore): void {
  const draft = store.areaDraft;
  if (draft?.chartEditing) {
    store.setAreaDraft({ ...draft, chartEditing: false, chartStep: 0 });
  }
}

export function radarChartEditBlockedReason({
  measureActive,
  routeEditing,
  offlineChartsOpen,
  chartReady,
}: {
  measureActive: boolean;
  routeEditing: boolean;
  offlineChartsOpen: boolean;
  chartReady: boolean;
}): string | undefined {
  if (measureActive) return 'Finish or clear the measurement before editing a radar area.';
  if (routeEditing) return 'Save or cancel the route edit before editing a radar area.';
  if (offlineChartsOpen) return 'Close Offline charts before editing a radar area on the chart.';
  if (!chartReady) return 'The chart is still loading.';
  return undefined;
}

// The everyday controls a helmsman reaches for underway, shown in their own section above the advanced
// rest. Data-driven: a radar that reports none of these collapses to a single Controls section, so the
// split never invents an empty group.
const PRIMARY_CONTROL_IDS: ReadonlySet<string> = new Set(['gain', 'sea', 'rain', 'range']);

export function isPrimaryControl(def: ControlDefinition): boolean {
  return PRIMARY_CONTROL_IDS.has(def.id);
}

// The radar power/operational-state control. It is rendered as the dedicated TX/Standby section driven
// by the live operational status, not as a generic slider or select in the controls list, so it is
// excluded from both the primary and advanced groups.
const POWER_CONTROL_IDS: ReadonlySet<string> = new Set(['power', 'status']);

export function isPowerControl(def: ControlDefinition): boolean {
  return POWER_CONTROL_IDS.has(def.id);
}
