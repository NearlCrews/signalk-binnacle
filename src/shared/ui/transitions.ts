import { cubicOut } from 'svelte/easing';
import { fly, scale, type TransitionConfig } from 'svelte/transition';
import { prefersReducedMotion } from '$shared/lib';

// The motion vocabulary for every surface that arrives over the chart. Milliseconds: JS transition
// timings sit outside the CSS token contract, so they cannot be custom properties. The CSS
// --ease-out token is the same cubic-out curve.
const PANEL_TRANSITION_MS = 180;
const MENU_TRANSITION_MS = 140;
const DOCK_OFFSET_PX = 24;
const RISE_OFFSET_PX = 32;

// left and right: a side panel slides in from the edge it docks to. below: a bottom sheet or the
// floating weather panel rises. grow: an anchored dropdown grows from its anchor corner.
export type SurfaceMotion = 'left' | 'right' | 'below' | 'grow';

export function surfaceTransition(node: Element, motion: SurfaceMotion): TransitionConfig {
  const reduce = prefersReducedMotion();
  if (motion === 'grow')
    return scale(node, {
      start: 0.92,
      opacity: 0.5,
      easing: cubicOut,
      duration: reduce ? 0 : MENU_TRANSITION_MS,
    });
  return fly(node, {
    x: motion === 'left' ? -DOCK_OFFSET_PX : motion === 'right' ? DOCK_OFFSET_PX : 0,
    y: motion === 'below' ? RISE_OFFSET_PX : 0,
    opacity: 0.3,
    easing: cubicOut,
    duration: reduce ? 0 : PANEL_TRANSITION_MS,
  });
}
