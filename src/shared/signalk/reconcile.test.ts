import { describe, expect, it } from 'vitest';
import { MAX_VALUES_PER_DELTA, MAX_VALUES_PER_UPDATE, reconcileDelta } from './reconcile';
import type { Context, Delta, Path, PathValueState, Value } from './types';

interface Collected {
  context: Context;
  path: Path;
  value: Value;
  source?: { label?: string; ref?: string };
  state?: PathValueState;
}

function collect(delta: Delta): Collected[] {
  const out: Collected[] = [];
  reconcileDelta(delta, (context, path, value, source, state) =>
    out.push({ context, path, value, source, state }),
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
    // A plain delta with no $source and no state carries neither field, byte-identical to before.
    expect(writes[0].source?.ref).toBeUndefined();
    expect(writes[0].state).toBeUndefined();
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

  it('stops at the cumulative value cap spanning several updates', () => {
    // Each update sits under the per-update guard, so only the cumulative cap can truncate this
    // delta, and it lands mid-update rather than on an update boundary.
    const perUpdate = 2_000;
    const updates = Array.from({ length: 5 }, (_, update) => ({
      values: Array.from({ length: perUpdate }, (_, index) => ({
        path: `navigation.test.${update}.${index}`,
        value: index,
      })),
    }));
    expect(perUpdate).toBeLessThan(MAX_VALUES_PER_UPDATE);

    const collected = collect({ context: 'vessels.self', updates } as unknown as Delta);

    expect(collected).toHaveLength(MAX_VALUES_PER_DELTA);
    const acceptedFromLast = MAX_VALUES_PER_DELTA - 4 * perUpdate;
    expect(collected.at(-1)?.path).toBe(`navigation.test.4.${acceptedFromLast - 1}`);
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

  it('captures $source as the source ref and falls back to it for the label', () => {
    // The staleness enforcer's deltas carry ONLY $source; without the fallback they would render
    // as "Unknown" exactly when a source dies.
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        { $source: 'ttyUSB0.GP', values: [{ path: 'navigation.speedOverGround', value: 3.85 }] },
      ],
    } as unknown as Delta;
    expect(collect(delta)[0].source).toEqual({ label: 'ttyUSB0.GP', ref: 'ttyUSB0.GP' });
  });

  it('prefers the source object label over $source while keeping the ref', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        {
          source: { label: 'n2kFromFile' },
          $source: 'n2kFromFile.160',
          values: [{ path: 'navigation.headingTrue', value: 1.1 }],
        },
      ],
    } as unknown as Delta;
    expect(collect(delta)[0].source).toEqual({ label: 'n2kFromFile', ref: 'n2kFromFile.160' });
  });

  it('parses the staleness enforcer state shape', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        {
          $source: 'ttyUSB0.GP',
          values: [
            {
              path: 'navigation.speedOverGround',
              value: null,
              state: {
                timedOut: true,
                lastValue: { timestamp: '2026-03-28T10:00:00Z', value: 5.5 },
              },
            },
          ],
        },
      ],
    } as unknown as Delta;
    const writes = collect(delta);
    expect(writes).toHaveLength(1);
    expect(writes[0].value).toBeNull();
    expect(writes[0].state).toEqual({
      timedOut: true,
      lastValue: { timestamp: '2026-03-28T10:00:00Z', value: 5.5 },
    });
  });

  it('degrades a malformed state container to a plain leaf', () => {
    const shapes = [42, 'stale', { timedOut: 'yes' }, { timedOut: false }, {}];
    for (const state of shapes) {
      const delta = {
        context: 'vessels.self' as Context,
        updates: [{ values: [{ path: 'navigation.speedOverGround', value: null, state }] }],
      } as unknown as Delta;
      const writes = collect(delta);
      expect(writes).toHaveLength(1);
      expect(writes[0].state).toBeUndefined();
    }
  });

  it('parses a timedOut state without a usable lastValue', () => {
    const delta = {
      context: 'vessels.self' as Context,
      updates: [
        {
          values: [
            { path: 'navigation.speedOverGround', value: null, state: { timedOut: true } },
            {
              path: 'navigation.headingTrue',
              value: null,
              state: { timedOut: true, lastValue: 'gone' },
            },
          ],
        },
      ],
    } as unknown as Delta;
    const writes = collect(delta);
    expect(writes[0].state).toEqual({ timedOut: true });
    expect(writes[1].state).toEqual({ timedOut: true });
  });
});
