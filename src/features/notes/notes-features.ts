import type { ExpressionSpecification } from 'maplibre-gl';
import { categoryRank, poiIconId } from '$entities/poi-icons';
import type { SymbolIconEntry } from '$entities/symbols';
import { latLonToLonLat } from '$shared/geo';
import { featureCollection, iconOffsetExpression } from '$shared/map';
import { navaidClassify, navaidIconId } from './navaid-symbols';
import type { NotePoint } from './notes-client';

// The registered map-image id for a note. Navaids resolve to a type- and side-specific
// symbol inferred from the name; every other category uses its disc.
function iconFor(note: NotePoint): string {
  if (note.category === 'navaid') return navaidIconId(navaidClassify(note.name));
  return poiIconId(note.category);
}

// One pass over the notes builds both the source data and the icon-offset match: each note resolves
// to a provided symbol or its built-in category disc, and a provided symbol with a non-zero anchor
// offset contributes one match arm keyed on its icon id.
export function buildRender(
  notes: readonly NotePoint[],
  managedIcon: (note: NotePoint) => SymbolIconEntry | undefined,
): { data: GeoJSON.FeatureCollection; iconOffset: ExpressionSpecification | [number, number] } {
  const offsets = new Map<string, readonly [number, number]>();
  const features = notes.map((note): GeoJSON.Feature => {
    const managed = managedIcon(note);
    if (managed && (managed.offset[0] !== 0 || managed.offset[1] !== 0)) {
      offsets.set(managed.iconId, managed.offset);
    }
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: latLonToLonLat(note.position),
      },
      properties: {
        id: note.id,
        name: note.name,
        category: note.category,
        description: note.description ?? '',
        skIcon: note.skIcon ?? '',
        ownedByBinnacle: note.ownedByBinnacle === true,
        rank: categoryRank(note.category),
        icon: managed?.iconId ?? iconFor(note),
        url: note.url ?? '',
        source: note.source ?? '',
        attribution: note.attribution ?? '',
      },
    };
  });
  return { data: featureCollection(features), iconOffset: iconOffsetExpression('icon', offsets) };
}
