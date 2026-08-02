// The object-shape guard every parser of stored or wire JSON needs before reading properties: it
// narrows unknown to a keyed record and excludes null and arrays, so the call sites stop re-spelling
// the `typeof x === 'object'` test and the follow-on cast. Arrays are excluded because the records
// guarded here (a notification, a stored profile, a saved view, chart metadata) are never arrays, so a
// stray array should fail the guard rather than slip through as an object.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]))
  );
}

// Drop a Map's oldest entry and return its key, or undefined when the Map is empty. A Map iterates
// in insertion order, so its first key is its oldest; the caller gets the key back because a capped
// cache usually has a parallel Map (attempt counts, timestamps) to clear alongside it.
export function evictOldestKey<K, V>(map: Map<K, V>): K | undefined {
  const oldest = map.keys().next();
  if (oldest.done) return undefined;
  map.delete(oldest.value);
  return oldest.value;
}
