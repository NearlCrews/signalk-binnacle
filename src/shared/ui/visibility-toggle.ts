// Shared prop shape for the visibility-toggle family (LayerToggle, ShowOnChartToggle,
// VisibilityToggle): onToggle reports the toggle's own next state, so the caller applies it
// directly instead of re-deriving it from the old value.
export interface VisibilityToggleProps {
  visible: boolean;
  onToggle: (visible: boolean) => void;
  disabled?: boolean;
  // An optional plain-language hover and focus tooltip. Falls back to the control's own label.
  description?: string;
  describedBy?: string;
}

// What a toggle renders for its accessible description.
interface ToggleDescription {
  // The aria-describedby value, absent when nothing describes the control.
  describedBy?: string;
  // Text for the toggle's own visually-hidden element, set only when the toggle owns the
  // description rather than pointing at the caller's element.
  ownText?: string;
}

// A title attribute never reaches a touch or keyboard user, so a description with no caller-owned
// element to point at becomes a visually-hidden element the control describes itself with. A
// describedBy from the caller wins, because the caller's own element already carries the text.
// Shared so the toggles in this family cannot drift apart on it.
export function resolveToggleDescription(
  props: Pick<VisibilityToggleProps, 'description' | 'describedBy'>,
  ownId: string,
): ToggleDescription {
  if (props.describedBy) return { describedBy: props.describedBy };
  if (!props.description) return {};
  return { describedBy: ownId, ownText: props.description };
}
