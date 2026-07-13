import type { Route } from '$entities/route';
import { downloadText, portableFilename } from '$shared/lib';
import { escapeXml } from './xml-entities';

// Serialize a route as a GPX 1.1 <rte>, the interchange format every other plotter, MFD, and
// Freeboard-SK reads. Named waypoints carry a <name>; unnamed waypoints remain unnamed so a round
// trip does not invent navigation data.
export function routeToGpx(route: Route): string {
  const points = route.waypoints
    .map((w) => {
      const name = w.name == null ? '' : `<name>${escapeXml(w.name)}</name>`;
      return `    <rtept lat="${w.position.latitude}" lon="${w.position.longitude}">${name}</rtept>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Binnacle" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${escapeXml(route.name)}</name>
${points}
  </rte>
</gpx>
`;
}

// Trigger a browser download of the route as a .gpx file, matching the track GeoJSON export.
export function routeGpxFilename(route: Route): string {
  return portableFilename(route.name, 'route', 'gpx');
}

export function downloadRouteGpx(route: Route): void {
  downloadText(routeGpxFilename(route), routeToGpx(route), 'application/gpx+xml');
}
