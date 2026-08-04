import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { MAX_USER_CHART_URL_LENGTH, type UserCharts } from '$entities/user-charts';
import AddChartForm from './AddChartForm.svelte';

const userCharts = {} as UserCharts;
const noop = (): void => {};

function body(writeBlocked = false): string {
  return render(AddChartForm, { props: { userCharts, writeBlocked, onDone: noop } }).body;
}

describe('AddChartForm', () => {
  it('bounds URL input and explains query-safe sharing before import', () => {
    const html = body();

    expect(html).toContain(`maxlength="${MAX_USER_CHART_URL_LENGTH}"`);
    expect(html).toMatch(/URLs with query values\s+stay on this device by default/);
    expect(html).toContain('sharing is reviewed before save');
  });

  it('keeps device-only URL import available while server writes are blocked', () => {
    const html = body(true);

    expect(html).not.toMatch(/<input[^>]+disabled/);
    expect(html).toMatch(/URLs with query values\s+stay on this device by default/);
  });

  it('labels the URL action as an import, since saving happens after review', () => {
    const html = body();

    expect(html).toContain('Import');
    expect(html).not.toMatch(/>\s*Add\s*</);
  });
});
