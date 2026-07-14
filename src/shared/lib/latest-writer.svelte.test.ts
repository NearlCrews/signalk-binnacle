import { describe, expect, it, vi } from 'vitest';
import { createLatestWriter } from './latest-writer.svelte';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = () => fail(new Error('failed'));
  });
  return { promise, resolve, reject };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createLatestWriter', () => {
  it('serializes requests and writes the latest submitted snapshot last', async () => {
    const first = deferred();
    const second = deferred();
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const writer = createLatestWriter(write, { savedDurationMs: 60_000 });

    writer.submit(1);
    writer.submit(2);
    writer.submit(3);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(1);

    first.resolve();
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(3);

    second.resolve();
    await tick();
    expect(writer.state).toBe('saved');
    writer.dispose();
  });

  it('surfaces only the last failure and retries the same snapshot', async () => {
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce();
    const writer = createLatestWriter(write, { savedDurationMs: 60_000 });

    writer.submit(7);
    await tick();
    expect(writer.state).toBe('error');

    writer.retry();
    await tick();
    expect(write).toHaveBeenLastCalledWith(7);
    expect(writer.state).toBe('saved');
    writer.dispose();
  });

  it('retries an undefined snapshot when undefined is a valid value', async () => {
    const write = vi
      .fn<(value: undefined) => Promise<void>>()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce();
    const writer = createLatestWriter(write, { savedDurationMs: 60_000 });

    writer.submit(undefined);
    await tick();
    writer.retry();
    await tick();

    expect(write).toHaveBeenCalledTimes(2);
    expect(writer.state).toBe('saved');
    writer.dispose();
  });
});
