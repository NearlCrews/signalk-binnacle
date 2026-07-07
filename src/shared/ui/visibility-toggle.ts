// Shared prop shape for the visibility-toggle family (LayerToggle, ShowOnChartToggle,
// VisibilityToggle): onToggle reports the toggle's own next state, so the caller applies it
// directly instead of re-deriving it from the old value.
export interface VisibilityToggleProps {
  visible: boolean;
  onToggle: (visible: boolean) => void;
  disabled?: boolean;
  // An optional plain-language hover and focus tooltip. Falls back to the control's own label.
  description?: string;
}
