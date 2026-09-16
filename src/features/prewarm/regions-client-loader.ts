import { createRetryableLazyUiLoader } from '$shared/lib';

export const loadRegionsClient = createRetryableLazyUiLoader(() => import('./regions-client'));
