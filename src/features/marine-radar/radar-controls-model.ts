import type { ControlDefinition, RadarControlEntry } from './radar-types';

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
  if (def.readOnly) return 'The radar reports this control as read-only.';
  if (entry?.allowed === false)
    return 'The radar is not allowing changes to this control right now.';
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
