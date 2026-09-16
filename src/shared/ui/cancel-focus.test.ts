import { expect, it, vi } from 'vitest';
import { restoreFocusAfterCancel } from './cancel-focus';

it('does not resolve a DOM trigger during server rendering', async () => {
  const getTrigger = vi.fn<() => HTMLElement | undefined>();
  await restoreFocusAfterCancel(getTrigger);
  expect(getTrigger).not.toHaveBeenCalled();
});
