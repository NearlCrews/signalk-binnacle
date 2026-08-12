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

// Trim a provider-controlled string and REJECT it when it is empty, over the caller's bound, or
// carries control characters. Rejecting rather than truncating is what the validators that mint an
// id, name, or enum-like field want: a value the provider sent oversized is a value it got wrong,
// and half of it is not a better answer than none. The resource decoders that must keep a long
// human name usable instead truncate; see cleanTruncatedText in $shared/signalk.
export function cleanBoundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
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
