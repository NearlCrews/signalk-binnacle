import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import MobConfirmDialog from './MobConfirmDialog.svelte';

function renderDialog(mark: {
  epochMs: number;
  position?: { latitude: number; longitude: number };
}) {
  return render(MobConfirmDialog, {
    props: {
      mark,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onTimeout: vi.fn(),
    },
  }).body;
}

describe('MobConfirmDialog', () => {
  it('includes the captured position in the alertdialog description once', () => {
    const body = renderDialog({
      epochMs: Date.parse('2026-07-18T12:34:56Z'),
      position: { latitude: 42.5, longitude: -83.25 },
    });

    expect(body).toContain('aria-describedby="mob-confirm-desc"');
    expect(body).toContain('42.5000° N');
    expect(body).toContain('83.2500° W');
    expect(body).toMatch(/class="fix muted-note [^"]+" aria-hidden="true"/);
    expect(body.match(/42\.5000° N/g)).toHaveLength(2);
  });

  it('includes the no-fix warning in the description and hides its visual duplicate', () => {
    const body = renderDialog({ epochMs: Date.parse('2026-07-18T12:34:56Z') });

    expect(body).toMatch(/class="fix muted-note no-fix [^"]+" aria-hidden="true"/);
    expect(body.match(/No GPS fix\. The alarm will sound without a position\./g)).toHaveLength(2);
  });
});
