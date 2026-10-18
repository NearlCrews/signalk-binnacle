import type { CompanionState } from '$features/prewarm';
import { formatBytes } from '$shared/lib';

// What Chart Locker's health poll actually knows, not a passage assurance: the amount cached, or
// which access, transport, or server failure stopped it. Saved-area readiness lives in the Offline
// charts panel, where it can be checked against coverage and update time.
export interface ChartLockerSummary {
  // The Offline charts menu tile's second line.
  value: string;
  // The full sentence for a tooltip or the Status list.
  title: string;
  // A state the navigator can act on, which the Status cell carries.
  problem: boolean;
  // A sign-in the navigator may never be able to give (only an administrator can), so it is told
  // quietly rather than as a caution.
  signIn: boolean;
}

const VALUES: Record<Exclude<CompanionState, 'serving'>, string> = {
  checking: 'Checking access',
  'needs-login': 'Sign in to use',
  'needs-admin': 'Administrator needed',
  'access-error': 'Access refused',
  offline: 'Not responding',
  error: 'Server error',
};

const TITLES: Record<Exclude<CompanionState, 'serving'>, string> = {
  checking: 'Offline charts: checking Chart Locker access',
  'needs-login': 'Offline charts: sign in to Signal K as an administrator',
  'needs-admin': 'Offline charts: the current Signal K user is not an administrator',
  'access-error':
    'Offline charts: Signal K reports an administrator session, but Chart Locker refused it',
  offline: 'Offline charts: not responding',
  error: 'Offline charts: server error',
};

export function chartLockerSummary(
  state: CompanionState,
  cacheBytes: number | null,
): ChartLockerSummary {
  if (state === 'serving') {
    const bytes = formatBytes(cacheBytes ?? 0);
    return {
      value: cacheBytes === null ? 'Cache ready' : `${bytes.value} ${bytes.unit} cached`,
      title: `Offline charts: online, cache ${bytes.value} ${bytes.unit}`,
      problem: false,
      signIn: false,
    };
  }
  const signIn = state === 'needs-login' || state === 'needs-admin';
  return { value: VALUES[state], title: TITLES[state], problem: state !== 'checking', signIn };
}
