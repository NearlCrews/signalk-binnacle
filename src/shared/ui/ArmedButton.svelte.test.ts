import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ArmedButton from './ArmedButton.svelte';

function body(armed: boolean, extra: { disabled?: boolean } = {}): string {
  return render(ArmedButton, {
    props: {
      label: 'Raise anchor',
      armedLabel: 'Confirm raise?',
      armed,
      tone: 'warning',
      onclick: () => {},
      ...extra,
    },
  }).body;
}

describe('ArmedButton', () => {
  it('shows the resting words and reserves the width of the confirm question', () => {
    const html = body(false);
    expect(html).toContain('data-reserve="Confirm raise?"');
    expect(html).toContain('<span>Raise anchor</span>');
    expect(html).toMatch(/class="btn btn-pill btn-strip label-reserve btn-warning/);
    // The visible text is the whole name: no masking label.
    expect(html).not.toContain('aria-label');
  });

  it('swaps the words when armed, keeping the button the same width', () => {
    const html = body(true);
    expect(html).toContain('data-reserve="Raise anchor"');
    expect(html).toContain('<span>Confirm raise?</span>');
  });

  it('carries the alarm tone and a disabled state when asked', () => {
    const html = render(ArmedButton, {
      props: {
        label: 'Steer to MOB',
        armedLabel: 'Confirm steer?',
        armed: false,
        tone: 'alarm',
        disabled: true,
        onclick: () => {},
      },
    }).body;
    expect(html).toContain('btn-alarm');
    expect(html).toContain('disabled');
  });
});
