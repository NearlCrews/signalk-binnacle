import { CHART_SOURCES } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import { coveringGroups, includedSummary, isFacet } from './source-summary.js';

const byId = Object.fromEntries(CHART_SOURCES.map((s) => [s.id, s]));
const pick = (...ids: string[]) => ids.map((id) => byId[id]);

describe('source-summary', () => {
  it('flags the quality and uncertainty children as facets', () => {
    expect(isFacet(byId['depth-noaa-enc-quality'])).toBe(true);
    expect(isFacet(byId['depth-bluetopo-uncertainty'])).toBe(true);
    expect(isFacet(byId['mpa-natura2000'])).toBe(true);
    expect(isFacet(byId['depth-noaa-enc'])).toBe(false);
    expect(isFacet(byId.basemap)).toBe(false);
  });

  it('buckets covering sources by plain category and drops facets', () => {
    const groups = coveringGroups(
      pick('depth-noaa-enc', 'depth-noaa-enc-quality', 'seamark', 'basemap', 'mpa-noaa'),
    );
    const ids = groups.flatMap((g) => g.sources.map((s) => s.id));
    expect(ids).not.toContain('depth-noaa-enc-quality');
    const charts = groups.find((g) => g.category === 'charts');
    expect(charts?.title).toBe('Base charts and depth');
    expect(charts?.sources.map((s) => s.id)).toEqual(['depth-noaa-enc', 'basemap']);
    const reference = groups.find((g) => g.category === 'reference');
    expect(reference?.sources.map((s) => s.id)).toEqual(['seamark']);
    // The specialist protected-area layer is split apart into the Advanced bucket, last.
    const advanced = groups.find((g) => g.category === 'advanced');
    expect(advanced?.title).toBe('Advanced layers');
    expect(advanced?.sources.map((s) => s.id)).toEqual(['mpa-noaa']);
    expect(groups[groups.length - 1].category).toBe('advanced');
  });

  it('summarizes the selected sources in plain language and de-dupes depth', () => {
    expect(includedSummary(pick('depth-noaa-enc', 'seamark', 'basemap'))).toBe(
      'The nautical chart, navigation marks, and the base map.',
    );
    expect(includedSummary(pick('depth-emodnet', 'seamark', 'basemap'))).toBe(
      'Depth, navigation marks, and the base map.',
    );
    expect(includedSummary(pick('basemap', 'depth-noaa-enc-quality'))).toBe('The base map.');
    expect(includedSummary([])).toBe('No charts selected for this area.');
  });
});
