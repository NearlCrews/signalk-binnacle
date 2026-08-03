import { type ChartSource, chartSourceById } from 'signalk-chart-sources';

// The catalog id of the vector base map. It is also the name of a z-band (see ZBand in ./types), so
// it is spelled once here rather than inline at each reader.
export const BASEMAP_SOURCE_ID = 'basemap';

type UpstreamMode = ChartSource['upstream']['mode'];

/** A catalog source narrowed to one upstream mode, so its mode-specific fields are readable. */
export type CatalogSourceOf<M extends UpstreamMode> = ChartSource & {
  upstream: Extract<ChartSource['upstream'], { mode: M }>;
};

export type XyzCatalogSource = CatalogSourceOf<'xyz'>;

/**
 * Look up a catalog source, optionally narrowing it to the upstream mode the caller can consume.
 *
 * Every catalog reader needs this guard, and each one used to spell its own, so a single missing
 * entry produced a different message depending on which module noticed. Throwing is right: the
 * catalog is a frozen constant of a pinned dependency, so neither branch is reachable without a
 * dependency bump, and the gate exercises the real path on every run.
 */
export function requireCatalogSource(id: string): ChartSource;
export function requireCatalogSource<M extends UpstreamMode>(
  id: string,
  mode: M,
): CatalogSourceOf<M>;
export function requireCatalogSource(id: string, mode?: UpstreamMode): ChartSource {
  const source = chartSourceById(id);
  if (!source) {
    throw new TypeError(`Missing chart source metadata for ${id}`);
  }
  if (mode && source.upstream.mode !== mode) {
    throw new TypeError(`Chart source ${id} is a ${source.upstream.mode} source, not ${mode}`);
  }
  return source;
}
