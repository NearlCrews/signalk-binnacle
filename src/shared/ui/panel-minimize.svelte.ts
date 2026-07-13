export interface PanelMinimizeController {
  readonly collapsed: boolean;
  onToggle: () => void;
  collapse: () => void;
  expand: () => void;
}

export function createPanelMinimize(): PanelMinimizeController {
  let collapsed = $state(false);
  return {
    get collapsed() {
      return collapsed;
    },
    onToggle: () => (collapsed = !collapsed),
    collapse: () => (collapsed = true),
    expand: () => (collapsed = false),
  };
}
