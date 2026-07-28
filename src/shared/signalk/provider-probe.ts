import { fetchJsonOrUndefined, hasControlCharacters, isRecord } from '$shared/lib';
import { asKeyedObject, authInit } from './resource';

// Several Signal K v2 APIs (history, weather, resources) expose a `_providers` sub-route that says
// which providers are registered: an answered empty result means the capability has no provider,
// while a non-OK status, a timeout, or a network failure means the server never said. That
// distinction is the only safe way to tell "no provider" from "no answer", so the probe lives here
// once rather than being re-rolled per client.
//
// The two APIs disagree on the response shape. History and weather answer with a keyed object of
// provider ids, while the resources API answers with a plain array of id strings (its
// getProvidersForResourceType returns string[], and a 2.27.0 server returns [] for an unregistered
// type). Each shape gets its own reader so a body of the wrong shape reads as no answer rather than
// quietly passing as an empty provider list.

const MAX_PROVIDER_ID_LENGTH = 128;
const MAGIC_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ProviderIds {
  // The accepted bounded provider ids, with the server's default first.
  ids: readonly string[];
}

// Undefined passes so an optional provider query parameter shares the guard with a parsed id.
export function safeProviderId(value: string | undefined): boolean {
  return (
    value === undefined ||
    (value.length > 0 &&
      value.length <= MAX_PROVIDER_ID_LENGTH &&
      !hasControlCharacters(value) &&
      !MAGIC_OBJECT_KEYS.has(value))
  );
}

// Reads the KEYED `_providers` route of the history and weather APIs. `{ ids: [] }` means the server
// answered and has no provider registered for this capability; undefined means the probe never got a
// usable answer (absent route, timeout, network failure, or a malformed body), so a caller must not
// report the capability as missing.
export async function fetchProviderIds(
  url: string,
  token: string | undefined,
  maxProviders: number,
): Promise<ProviderIds | undefined> {
  const keyed = asKeyedObject(await fetchJsonOrUndefined(url, authInit(token)));
  if (!keyed) return undefined;
  const isDefault = (id: string): boolean => {
    const entry = keyed[id];
    return isRecord(entry) && entry.isDefault === true;
  };
  const ids = Object.keys(keyed)
    .filter((id) => safeProviderId(id))
    .sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)))
    .slice(0, maxProviders);
  return { ids };
}

// Reads the ARRAY `_providers` route of the resources API, with the same answered-versus-unanswered
// contract as fetchProviderIds. The array carries no default marker, so the server's order stands.
// Only an array of strings is accepted: a keyed object, or an array holding anything else, is a body
// this reader does not understand, which is not the same as a server reporting no providers.
export async function fetchProviderIdList(
  url: string,
  token: string | undefined,
  maxProviders: number,
): Promise<ProviderIds | undefined> {
  const body = await fetchJsonOrUndefined<unknown>(url, authInit(token));
  if (!Array.isArray(body)) return undefined;
  const ids: string[] = [];
  for (const entry of body) {
    if (typeof entry !== 'string') return undefined;
    if (safeProviderId(entry)) ids.push(entry);
  }
  return { ids: ids.slice(0, maxProviders) };
}
