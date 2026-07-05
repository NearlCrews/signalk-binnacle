// A composable reactive time getter that ticks on a fixed interval. Returns a getter that tracks
// the current timestamp, updating at the specified interval. The cleanup happens automatically when
// the component unmounts (via Svelte's effect cleanup). This standardizes the Clock pattern with a
// simpler API: no manual dispose() call required.
export function useTime(intervalMs = 1000): () => number {
  let now = $state(Date.now());

  $effect(() => {
    if (typeof setInterval !== 'function') return;
    const timer = setInterval(() => {
      now = Date.now();
    }, intervalMs);

    return () => clearInterval(timer);
  });

  return () => now;
}
