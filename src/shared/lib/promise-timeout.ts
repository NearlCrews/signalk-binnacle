// Race a promise against a deadline. Distinct from withTimeout in fetch-timeout.ts, which builds
// an aborting RequestInit: this one cannot cancel the underlying work, it only stops a caller
// from awaiting forever (a dead worker's Comlink call, a stalled dynamic import).
export function withPromiseTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}
