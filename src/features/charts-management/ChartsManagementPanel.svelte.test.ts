import { describe, expect, it } from 'vitest';
import PANEL_SOURCE from './ChartsManagementPanel.svelte?raw';

describe('ChartsManagementPanel filenames', () => {
  it('reveals a valid chart filename in its touch-accessible details', () => {
    expect(PANEL_SOURCE).toMatch(/<dt>File<\/dt>[\s\S]*chart-file-detail/);
    expect(PANEL_SOURCE).toContain('<span class="num">{chart.fileName}</span>');
  });

  it('wraps an invalid filename instead of leaving it in an ellipsis-only row', () => {
    expect(PANEL_SOURCE).toContain('class="chart-file chart-file--full"');
    expect(PANEL_SOURCE).toMatch(/\.chart-file--full,[\s\S]*overflow-wrap:\s*anywhere/);
  });
});
