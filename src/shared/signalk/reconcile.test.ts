import { describe, expect, it } from 'vitest';
import { MAX_VALUES_PER_UPDATE, reconcileDelta } from './reconcile';
import type { Context, Delta, Path, Value } from './types';

interface Collected {
  context: Context;
  path: Path;
  value: Value;
  source?: { label?: string };
}

function collect(delta: Delta): Collected[] {
  const out: Collected[] = [];
  reconcileDelta(delta, (context, path, value, source) =>
    out.push({ context, path, value, source }),
  );
  return out;
}

describe('reconcileDelta', () => {
  it('flattens values with the delta context', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        {
          values: [
            { path: 'navigation.speedOverGround', value: 3.85 },
            { path: 'navigation.courseOverGroundTrue', value: 2.97 },
          ],
        },
      ],
    } as unknown as Delta;
    const writes = collect(delta);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      context: 'vessels.self',
      path: 'navigation.speedOverGround',
      value: 3.85,
    });
  });

  it('defaults a missing context to vessels.self', () => {
    const delta = {
      updates: [{ values: [{ path: 'navigation.headingTrue', value: 1.1 }] }],
    } as unknown as Delta;
    expect(collect(delta)[0].context).toBe('vessels.self');
  });

  it('ignores meta-only updates', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [{ meta: [{ path: 'navigation.speedOverGround', value: { units: 'm/s' } }] }],
    } as unknown as Delta;
    expect(collect(delta)).toHaveLength(0);
  });

  it('tolerates updates with neither values nor meta', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [{}],
    } as unknown as Delta;
    expect(collect(delta)).toHaveLength(0);
  });

  it('passes a null value to the leaf callback (Signal K path clear)', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [{ values: [{ path: 'notifications.mob', value: null }] }],
    } as unknown as Delta;
    const writes = collect(delta);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      context: 'vessels.self',
      path: 'notifications.mob',
      value: null,
    });
  });

  it('skips a malformed values element without a string path', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        {
          values: [
            null,
            { value: 1 },
            { path: 42, value: 2 },
            { path: 'navigation.speedOverGround', value: 3.85 },
          ],
        },
      ],
    } as unknown as Delta;
    const writes = collect(delta);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('navigation.speedOverGround');
  });

  it('passes an update source label to every value in that update', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        {
          source: { label: 'NMEA2000.35' },
          values: [
            { path: 'navigation.speedOverGround', value: 3.85 },
            { path: 'navigation.headingTrue', value: 1.1 },
          ],
        },
      ],
    } as unknown as Delta;
    const writes = collect(delta);
    expect(writes.map((w) => w.source?.label)).toEqual(['NMEA2000.35', 'NMEA2000.35']);
  });

  it('rejects unsafe contexts and paths', () => {
    expect(
      collect({
        context: `vessels.${'x'.repeat(600)}`,
        updates: [{ values: [{ path: 'navigation.position', value: null }] }],
      } as unknown as Delta),
    ).toEqual([]);
    expect(
      collect({
        context: 'vessels.self',
        updates: [
          {
            values: [
              { path: `navigation.${'x'.repeat(600)}`, value: 1 },
              { path: 'navigation.\u0000position', value: 2 },
              { path: 'navigation.position', value: 3 },
            ],
          },
        ],
      } as unknown as Delta),
    ).toHaveLength(1);
  });

  it('drops an oversized update before iterating its values', () => {
    const values = Array.from({ length: MAX_VALUES_PER_UPDATE + 1 }, (_, index) => ({
      path: `navigation.test.${index}`,
      value: index,
    }));
    expect(collect({ context: 'vessels.self', updates: [{ values }] } as unknown as Delta)).toEqual(
      [],
    );
  });
});
