import { describe, expect, it } from 'vitest';
import { nearestSnapPosition, SNAP_RADIUS_PX, type SnapProjection } from './route-snap';

// A linear equirectangular projection: scale is pixels per degree of longitude, yScale pixels per
// degree of latitude. Letting the two differ stands in for a real map projection where degrees per
// pixel vary by axis and latitude, which the snap math must absorb by working in pixels.
function linearProjection(scale: number, yScale = scale): SnapProjection {
  return {
    project: (lng, lat) => ({ x: lng * scale, y: -lat * yScale }),
    unproject: (x, y) => ({ lng: x / scale, lat: -y / yScale }),
  };
}

function pointerAt(projection: SnapProjection, lng: number, lat: number): { x: number; y: number } {
  return projection.project(lng, lat);
}

describe('nearestSnapPosition', () => {
  it('returns undefined with no targets', () => {
    const projection = linearProjection(100);
    expect(nearestSnapPosition(pointerAt(projection, 20, 10), [], projection)).toBeUndefined();
  });

  it('snaps to a target within the pixel radius and returns its exact stored position', () => {
    const projection = linearProjection(100);
    const position = { latitude: 10 + 1 / 3, longitude: 20 + 1 / 7 };
    // 0.05 degrees at 100 px per degree is 5 px off on each axis, about 7.1 px total.
    const pointer = pointerAt(projection, position.longitude + 0.05, position.latitude + 0.05);
    expect(nearestSnapPosition(pointer, [{ position }], projection)).toBe(position);
  });

  it('leaves a vertex alone when every target is beyond the radius', () => {
    const projection = linearProjection(100);
    const position = { latitude: 10, longitude: 20 };
    // 0.2 degrees is 20 px, past the 12 px radius.
    const pointer = pointerAt(projection, 20.2, 10);
    expect(nearestSnapPosition(pointer, [{ position }], projection)).toBeUndefined();
  });

  it('picks the nearest of several candidates in range', () => {
    const projection = linearProjection(100);
    const near = { latitude: 10, longitude: 20.03 };
    const far = { latitude: 10, longitude: 19.92 };
    const pointer = pointerAt(projection, 20, 10);
    expect(nearestSnapPosition(pointer, [{ position: far }, { position: near }], projection)).toBe(
      near,
    );
  });

  it('holds the radius in screen space: the same geographic offset snaps zoomed out, not in', () => {
    const position = { latitude: 10, longitude: 20.1 };
    const pointer = { lng: 20, lat: 10 };
    // Zoomed out: 0.1 degrees is 5 px, inside the radius.
    const coarse = linearProjection(50);
    expect(
      nearestSnapPosition(pointerAt(coarse, pointer.lng, pointer.lat), [{ position }], coarse),
    ).toBe(position);
    // Zoomed in: the same 0.1 degrees is 100 px, far outside it.
    const fine = linearProjection(1000);
    expect(
      nearestSnapPosition(pointerAt(fine, pointer.lng, pointer.lat), [{ position }], fine),
    ).toBeUndefined();
  });

  it('measures each axis through the projection, not in raw degrees', () => {
    const position = { latitude: 15, longitude: 20 };
    // Five degrees of latitude is 5 px when latitude maps at 1 px per degree, so it snaps.
    const squat = linearProjection(100, 1);
    expect(nearestSnapPosition(pointerAt(squat, 20, 10), [{ position }], squat)).toBe(position);
    // The same five degrees is 50 px when latitude maps at 10 px per degree, so it does not.
    const tall = linearProjection(100, 10);
    expect(nearestSnapPosition(pointerAt(tall, 20, 10), [{ position }], tall)).toBeUndefined();
  });

  it('snaps across the antimeridian to the stored in-range longitude', () => {
    const projection = linearProjection(100);
    const position = { latitude: 0, longitude: -179.999 };
    // The pointer sits just west of the seam in the map's unwrapped longitude space; the stored
    // longitude is one world copy away but 0.2 px on screen.
    const pointer = pointerAt(projection, 179.999, 0);
    expect(nearestSnapPosition(pointer, [{ position }], projection)).toBe(position);
    const east = { latitude: 0, longitude: 179.999 };
    const westPointer = pointerAt(projection, -179.999, 0);
    expect(nearestSnapPosition(westPointer, [{ position: east }], projection)).toBe(east);
  });

  it('honors an explicit radius override', () => {
    const projection = linearProjection(100);
    const position = { latitude: 10, longitude: 20.2 };
    const pointer = pointerAt(projection, 20, 10);
    expect(nearestSnapPosition(pointer, [{ position }], projection, 25)).toBe(position);
    expect(
      nearestSnapPosition(pointer, [{ position }], projection, SNAP_RADIUS_PX),
    ).toBeUndefined();
  });
});
