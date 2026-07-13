import {
  cleanProfileName,
  isProfileSettings,
  MAX_PROFILES,
  type Profile,
  type ProfileSettings,
} from '$entities/profile';
import { downloadText, isRecord } from '$shared/lib';

export { isProfileSettings } from '$entities/profile';

// A validated import: the settings to recreate plus the name to recreate them under. The importer
// calls store.save(name, settings), so an id and timestamps are deliberately not carried over.
export interface ImportedProfile {
  name: string;
  settings: ProfileSettings;
}

// Pull the candidate settings out of one parsed item: a full exported Profile carries `.settings`, a
// bare ProfileSettings carries `.theme` directly. The name comes from the Profile when present so the
// importer can keep it; a bare settings object has no name, so a fallback is supplied.
function toImported(item: unknown): ImportedProfile | undefined {
  if (!isRecord(item)) return undefined;
  if (isRecord(item.settings)) {
    if (!isProfileSettings(item.settings)) return undefined;
    const name = cleanProfileName(item.name) ?? 'Imported profile';
    return { name, settings: item.settings };
  }
  if (isProfileSettings(item)) {
    return { name: 'Imported profile', settings: item };
  }
  return undefined;
}

// Parse an exported profile document into a list of validated ImportedProfiles, the inverse of
// downloadProfileJson. Tolerant of three shapes: a single exported Profile, an array of Profiles or
// bare ProfileSettings, and a { profiles: [...] } envelope. Each candidate is strictly validated, so
// only well-formed profiles survive. Returns an empty array on a parse error or when nothing is valid.
export function parseProfilesJson(text: string): ImportedProfile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (isRecord(parsed) && Array.isArray(parsed.profiles)) {
    items = parsed.profiles;
  } else {
    items = [parsed];
  }
  const imported: ImportedProfile[] = [];
  for (const item of items) {
    const result = toImported(item);
    if (result) imported.push(result);
    if (imported.length >= MAX_PROFILES) break;
  }
  return imported;
}

// Trigger a browser download of a profile as pretty JSON, matching the route GPX and track GeoJSON
// exports. downloadText is Node-guarded, so this is inert outside a DOM context.
export function downloadProfileJson(profile: Profile): void {
  const json = JSON.stringify(profile, null, 2);
  downloadText(`${profile.name || 'profile'}.binnacle-profile.json`, json, 'application/json');
}
