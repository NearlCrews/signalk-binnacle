import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDynamicOverlays } from './build-overlays';

const factories = vi.hoisted(() => {
  const marker = (id: string) => ({ id });
  return {
    createAisOverlay: vi.fn(() => marker('ais')),
    createAisTrailsOverlay: vi.fn(
      (
        _origin: string,
        _getToken: () => string | undefined,
        _isAvailable: () => boolean,
        _selfContext: () => string | undefined,
      ) => marker('ais-trails'),
    ),
    createAisVectorsOverlay: vi.fn((_targets: unknown, _assessment: () => unknown) =>
      marker('ais-vectors'),
    ),
    createAnchorOverlay: vi.fn(() => marker('anchor')),
    createCollisionOverlay: vi.fn(() => marker('collision')),
    createCourseOverlay: vi.fn(() => marker('course')),
    createHistoryTrackOverlay: vi.fn(() => marker('history-track')),
    createMeasureOverlay: vi.fn(() => marker('measure')),
    createMobOverlay: vi.fn(() => marker('mob')),
    createRouteOverlay: vi.fn(() => marker('route')),
    createTidesOverlay: vi.fn(() => marker('tides')),
    createTimeTravelOverlay: vi.fn(() => marker('time-travel')),
    createTrackOverlay: vi.fn(() => marker('track')),
    createVesselOverlay: vi.fn(() => marker('vessel')),
    createWaypointOverlay: vi.fn(() => marker('waypoints')),
  };
});

vi.mock('$features/ais-layer', () => ({
  createAisOverlay: factories.createAisOverlay,
  createAisTrailsOverlay: factories.createAisTrailsOverlay,
  createAisVectorsOverlay: factories.createAisVectorsOverlay,
}));
vi.mock('$features/anchor-watch', () => ({ createAnchorOverlay: factories.createAnchorOverlay }));
vi.mock('$features/lookout', () => ({ createCollisionOverlay: factories.createCollisionOverlay }));
vi.mock('$features/measure', () => ({ createMeasureOverlay: factories.createMeasureOverlay }));
vi.mock('$features/mob', () => ({ createMobOverlay: factories.createMobOverlay }));
vi.mock('$features/route-layer', () => ({
  createCourseOverlay: factories.createCourseOverlay,
  createRouteOverlay: factories.createRouteOverlay,
}));
vi.mock('$features/tides', () => ({ createTidesOverlay: factories.createTidesOverlay }));
vi.mock('$features/time-travel', () => ({
  createTimeTravelOverlay: factories.createTimeTravelOverlay,
}));
vi.mock('$features/track-layer', () => ({
  createHistoryTrackOverlay: factories.createHistoryTrackOverlay,
  createTrackOverlay: factories.createTrackOverlay,
}));
vi.mock('$features/vessel-layer', () => ({ createVesselOverlay: factories.createVesselOverlay }));
vi.mock('$features/waypoints', () => ({ createWaypointOverlay: factories.createWaypointOverlay }));

function setup(marineRadarLayer?: { id: string }) {
  const assessment = { contacts: [], worst: 'clear' };
  const deps = {
    origin: 'http://boat.local',
    getToken: vi.fn(() => 'live-token'),
    store: { selfContext: 'vessels.self' },
    vessel: { name: 'vessel' },
    aisTargets: { name: 'ais-targets' },
    anchor: { name: 'anchor' },
    mob: { name: 'mob' },
    measure: { name: 'measure' },
    collision: { name: 'collision', assessment },
    guidance: { name: 'guidance' },
    recorder: { name: 'recorder' },
    routeStore: { name: 'routes' },
    tides: { name: 'tides' },
    units: { name: 'units' },
    waypoints: { name: 'waypoints' },
    symbols: { name: 'symbols' },
    trackSettings: { value: { intervalSeconds: 10 } },
    savedTracks: { list: vi.fn() },
    notesOverlay: { id: 'notes' },
    onAnchorMoved: vi.fn(),
    aisTrailsAvailable: vi.fn(() => true),
    historyProviders: vi.fn(() => ({ providers: [] })),
    timeTravel: { name: 'time-travel' },
    marineRadarLayer,
  };
  return { deps, overlays: buildDynamicOverlays(deps as never) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildDynamicOverlays', () => {
  it('locks the complete bottom-to-top safety and navigation order', () => {
    const radar = { id: 'marine-radar' };
    const { overlays } = setup(radar);

    expect(overlays.map(({ id }) => id)).toEqual([
      'tides',
      'anchor',
      'measure',
      'route',
      'course',
      'waypoints',
      'notes',
      'ais-trails',
      'ais-vectors',
      'ais',
      'collision',
      'mob',
      'history-track',
      'track',
      'vessel',
      'time-travel',
      'marine-radar',
    ]);
  });

  it('omits only the optional radar layer when no radar controller supplied one', () => {
    const { overlays } = setup();
    expect(overlays.map(({ id }) => id)).toEqual([
      'tides',
      'anchor',
      'measure',
      'route',
      'course',
      'waypoints',
      'notes',
      'ais-trails',
      'ais-vectors',
      'ais',
      'collision',
      'mob',
      'history-track',
      'track',
      'vessel',
      'time-travel',
    ]);
  });

  it('forwards live getters and each store to the intended overlay factory', () => {
    const { deps } = setup();

    expect(factories.createTidesOverlay).toHaveBeenCalledWith(deps.tides, deps.units);
    expect(factories.createAnchorOverlay).toHaveBeenCalledWith(
      deps.anchor,
      deps.vessel,
      deps.onAnchorMoved,
    );
    expect(factories.createMeasureOverlay).toHaveBeenCalledWith(deps.measure, deps.units);
    expect(factories.createRouteOverlay).toHaveBeenCalledWith(deps.routeStore);
    expect(factories.createWaypointOverlay).toHaveBeenCalledWith(deps.waypoints, deps.symbols);
    expect(factories.createAisTrailsOverlay).toHaveBeenCalledWith(
      deps.origin,
      deps.getToken,
      deps.aisTrailsAvailable,
      expect.any(Function),
    );
    const selfContext = factories.createAisTrailsOverlay.mock.calls[0]?.[3];
    expect(selfContext?.()).toBe('vessels.self');
    deps.store.selfContext = 'vessels.changed';
    expect(selfContext?.()).toBe('vessels.changed');
    expect(factories.createAisVectorsOverlay).toHaveBeenCalledWith(
      deps.aisTargets,
      expect.any(Function),
    );
    const collisionAssessment = factories.createAisVectorsOverlay.mock.calls[0]?.[1];
    expect(collisionAssessment?.()).toBe(deps.collision.assessment);
    expect(factories.createAisOverlay).toHaveBeenCalledWith(deps.aisTargets);
    expect(factories.createHistoryTrackOverlay).toHaveBeenCalledWith(
      deps.origin,
      deps.getToken,
      deps.historyProviders,
    );
    expect(factories.createTrackOverlay).toHaveBeenCalledWith(
      deps.recorder,
      deps.trackSettings,
      deps.savedTracks,
    );
    expect(factories.createCourseOverlay).toHaveBeenCalledWith(deps.guidance, deps.vessel);
    expect(factories.createCollisionOverlay).toHaveBeenCalledWith(deps.collision);
    expect(factories.createMobOverlay).toHaveBeenCalledWith(deps.mob, deps.vessel);
    expect(factories.createVesselOverlay).toHaveBeenCalledWith(deps.vessel);
    expect(factories.createTimeTravelOverlay).toHaveBeenCalledWith(deps.timeTravel);
  });
});
