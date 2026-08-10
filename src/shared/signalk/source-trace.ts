// The bounded recent-source trace for watch-critical paths, and the cue derived from it. Signal K
// remains the source authority: Binnacle never chooses a source, it only reports what the server
// sent. Each traced path keeps its own trace, so unlike references (magnetic versus true heading
// are different paths) are never compared as if they were equivalent.

// One observed source handoff on a path: the label the server started sending values from, and
// when. The first entry of a trace is the first source observed (or the first since a reconnect),
// which is not a handoff.
export interface SourceTransition {
  label: string;
  epoch: number;
}

// How far back a handoff still colors the cue. Watch-handoff timescale: a source that changed
// within the last ten minutes is worth a word at the helm; older transitions, and sources that
// stopped appearing before the window, are excluded as stale rather than reported as a live
// disagreement.
export const SOURCE_CUE_WINDOW_MS = 10 * 60 * 1000;

export type SourceCue =
  | { kind: 'changed'; from: string; to: string; atEpoch: number }
  | { kind: 'multiple'; labels: string[] };

// The source refs that fed a traced path within the window, or empty below two: one recent source
// is the normal case and not worth a word. The one definition of "recently multi-source" shared by
// the instrument detail's rows and the watch-handoff fact, over the per-source sample map a traced
// PathCell carries (structural element type, so this module does not import the store).
export function recentSourceRefs(
  samples: ReadonlyMap<string, { epoch: number }> | undefined,
  now: number,
  windowMs = SOURCE_CUE_WINDOW_MS,
): string[] {
  if (samples === undefined || samples.size < 2) return [];
  const refs: string[] = [];
  for (const [ref, sample] of samples) {
    if (now - sample.epoch <= windowMs) refs.push(ref);
  }
  return refs.length >= 2 ? refs : [];
}

export function sourceCue(
  trace: readonly SourceTransition[],
  now: number,
  windowMs = SOURCE_CUE_WINDOW_MS,
): SourceCue | undefined {
  if (trace.length < 2) return undefined;
  const cutoff = now - windowMs;
  const recent: number[] = [];
  for (let index = 1; index < trace.length; index += 1) {
    if (trace[index].epoch >= cutoff) recent.push(index);
  }
  if (recent.length === 0) return undefined;
  if (recent.length === 1) {
    const index = recent[0];
    return {
      kind: 'changed',
      from: trace[index - 1].label,
      to: trace[index].label,
      atEpoch: trace[index].epoch,
    };
  }
  const labels = [
    ...new Set(recent.flatMap((index) => [trace[index - 1].label, trace[index].label])),
  ];
  return { kind: 'multiple', labels };
}
