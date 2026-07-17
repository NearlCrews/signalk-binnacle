export type FloatingPlacement = 'auto' | 'above' | 'below';
export type FloatingAlign = 'start' | 'end';

interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface FloatingPositionOptions {
  placement?: FloatingPlacement;
  align?: FloatingAlign;
  edge?: number;
  gap?: number;
}

export interface FloatingPosition {
  left: number;
  top: number;
  opensBelow: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function floatingPosition(
  anchor: RectLike,
  surface: Pick<RectLike, 'width' | 'height'>,
  viewport: ViewportSize,
  options: FloatingPositionOptions = {},
): FloatingPosition {
  const placement = options.placement ?? 'auto';
  const align = options.align ?? 'start';
  const edge = options.edge ?? 8;
  const gap = options.gap ?? 4;
  const roomAbove = anchor.top - gap - edge;
  const roomBelow = viewport.height - anchor.bottom - gap - edge;
  const fitsAbove = roomAbove >= surface.height;
  const fitsBelow = roomBelow >= surface.height;

  let opensBelow: boolean;
  if (placement === 'above') {
    opensBelow = !fitsAbove && (fitsBelow || roomBelow >= roomAbove);
  } else {
    opensBelow = fitsBelow || (!fitsAbove && roomBelow >= roomAbove);
  }

  const preferredLeft = align === 'end' ? anchor.right - surface.width : anchor.left;
  const preferredTop = opensBelow ? anchor.bottom + gap : anchor.top - gap - surface.height;

  return {
    left: clamp(preferredLeft, edge, viewport.width - surface.width - edge),
    top: clamp(preferredTop, edge, viewport.height - surface.height - edge),
    opensBelow,
  };
}
