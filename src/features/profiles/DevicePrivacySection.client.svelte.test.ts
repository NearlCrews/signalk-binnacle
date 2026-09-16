import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrivacyReport } from '$shared/privacy';
import DevicePrivacySection from './DevicePrivacySection.svelte';

const PARTIAL: PrivacyReport = {
  operation: 'forget-credentials',
  status: 'partial',
  clearedOwnerIds: [],
  failures: [
    { ownerId: 'signalk-credentials', message: 'Storage is blocked by browser policy' },
    { ownerId: 'indexed-db', message: 'A database is still open' },
  ],
};

const mounted: Array<() => void> = [];

function mountSection(report: PrivacyReport) {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(DevicePrivacySection, {
      target,
      props: {
        onForgetCredentials: async () => report,
        onEraseAllLocalData: async () => report,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

function buttonText(target: HTMLElement, text: string): HTMLButtonElement {
  const button = [...target.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`no button labeled ${text}`);
  return button;
}

function clickText(target: HTMLElement, text: string): void {
  buttonText(target, text).click();
  flushSync();
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('DevicePrivacySection partial failures', () => {
  it.each(['Forget credentials', 'Erase all local data'])(
    'returns focus to the recreated %s action after cancellation',
    async (label) => {
      const target = mountSection(PARTIAL);
      buttonText(target, label).focus();
      clickText(target, label);
      expect(document.activeElement).toBe(buttonText(target, 'Cancel'));
      clickText(target, 'Cancel');
      await tick();
      expect(document.activeElement).toBe(buttonText(target, label));
      expect(target.querySelector('.confirm')).toBeNull();
    },
  );

  it('does not reclaim focus from another control after cancellation', async () => {
    const target = mountSection(PARTIAL);
    const other = document.createElement('button');
    other.textContent = 'Another action';
    target.append(other);
    clickText(target, 'Forget credentials');
    clickText(target, 'Cancel');
    other.focus();
    await tick();
    expect(document.activeElement).toBe(other);
  });

  it('separates one failure from the next and from the sentence that follows', async () => {
    const target = mountSection(PARTIAL);
    clickText(target, 'Forget credentials');
    const confirm = target.querySelector<HTMLButtonElement>('.btn-danger');
    if (!confirm) throw new Error('no confirm button');
    confirm.click();

    await vi.waitFor(() => {
      expect(target.textContent).toContain('Reloading shortly.');
    });
    expect(target.textContent).toContain(
      'Signal K credentials: Storage is blocked by browser policy; offline browser databases: A database is still open. Reloading shortly.',
    );
  });
});
