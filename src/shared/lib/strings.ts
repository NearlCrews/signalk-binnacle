export function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127)) return true;
  }
  return false;
}

// Whether a provider-controlled string is unusable as an object key or path segment: empty,
// oversized, carrying control characters, or a prototype-polluting name. One predicate, so the
// resource-id and notification-path walks cannot drift apart on which keys they refuse.
export function isUnsafeProviderKey(key: string): boolean {
  return (
    key.length === 0 ||
    key.length > 512 ||
    hasControlCharacters(key) ||
    key === '__proto__' ||
    key === 'prototype' ||
    key === 'constructor'
  );
}
