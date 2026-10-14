import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { attribute, tag } from '$shared/testing';
import VisibilityToggle from './VisibilityToggle.svelte';

const input = (html: string): string => tag(html, /<input[^>]*>/, 'switch');

describe('VisibilityToggle', () => {
  it('is a switch with a constant name, its state carried by checked', () => {
    for (const visible of [true, false]) {
      const body = render(VisibilityToggle, { props: { visible, onToggle: () => {} } }).body;
      expect(attribute(input(body), 'role')).toBe('switch');
      expect(attribute(input(body), 'aria-label')).toBe('Show on chart');
      expect(input(body).includes('checked')).toBe(visible);
    }
  });

  it('names the row it belongs to, so a list of switches is distinguishable', () => {
    const body = render(VisibilityToggle, {
      props: { visible: true, onToggle: () => {}, itemName: 'Harbor approach' },
    }).body;
    expect(attribute(input(body), 'aria-label')).toBe('Show Harbor approach on chart');
  });
});
