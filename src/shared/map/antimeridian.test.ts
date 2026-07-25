import { describe, expect, it } from 'vitest';
import { antimeridianLineGeometry } from './antimeridian';

describe('antimeridianLineGeometry', () => {
  it('keeps an ordinary line unchanged', () => {
    expect(
      antimeridianLineGeometry([
        [-82, 42],
        [-81, 43],
      ]),
    ).toEqual({
      type: 'LineString',
      coordinates: [
        [-82, 42],
        [-81, 43],
      ],
    });
  });

  it('canonicalizes unwrapped geodesic longitudes before splitting', () => {
    expect(
      antimeridianLineGeometry([
        [179.9, 0],
        [180.1, 0],
      ]),
    ).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [179.9, 0],
          [180, 0],
        ],
        [
          [-180, 0],
          [-179.9, 0],
        ],
      ],
    });
  });

  it('splits an eastbound crossing at both antimeridian world edges', () => {
    expect(
      antimeridianLineGeometry([
        [179, 10],
        [-179, 12],
      ]),
    ).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [179, 10],
          [180, 11],
        ],
        [
          [-180, 11],
          [-179, 12],
        ],
      ],
    });
  });

  it('splits a westbound crossing and preserves later points', () => {
    expect(
      antimeridianLineGeometry([
        [-179, 10],
        [179, 12],
        [178, 13],
      ]),
    ).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [-179, 10],
          [-180, 11],
        ],
        [
          [180, 11],
          [179, 12],
          [178, 13],
        ],
      ],
    });
  });
});
