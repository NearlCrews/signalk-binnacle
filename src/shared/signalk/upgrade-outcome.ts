import type { UpgradeOutcome } from './auth.svelte';

// The one copy table for a failed read and write upgrade, shared by the app-wide auth banner and
// the in-panel WriteAccessNote so both surfaces describe the same outcome in the same words.
export const UPGRADE_OUTCOME_COPY: Record<UpgradeOutcome, { message: string; action: string }> = {
  declined: {
    message: 'Write access was declined. Binnacle still has read-only access.',
    action: 'Request again',
  },
  unanswered: {
    message:
      'The write access request was not approved in time. It may still be waiting in Signal K under Security, then Access Requests.',
    action: 'Request again',
  },
  unreachable: {
    message:
      'Could not reach the server to request write access. Binnacle still has read-only access.',
    action: 'Try again',
  },
};
