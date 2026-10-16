import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChartViewStatusKind } from '$shared/map';
import { attribute, tag } from '$shared/testing';
import ChartStatusBadge from './ChartStatusBadge.svelte';

const STATUSES: ChartViewStatusKind[] = [
  'active',
  'active-overzoomed',
  'reference-only',
  'out-of-coverage',
  'source-failed',
  'source-loading',
  'base-unavailable',
];

// Speech input users say the text they see, so the chip takes its name from its visible label and
// keeps the longer explanation as its description.
describe('ChartStatusBadge', () => {
  it.each(STATUSES)('names the %s chip by its visible label', (status) => {
    const { body } = render(ChartStatusBadge, { props: { status, onOpenLayers: vi.fn() } });

    const button = tag(body, /<button[^>]*chart-status[^>]*>/, 'chart status chip');
    expect(attribute(button, 'aria-label')).toBeUndefined();
    expect(attribute(button, 'title')).toMatch(/Tap to open Layers and charts/);
  });
});
