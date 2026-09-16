import type { Route } from '$entities/route';
import {
  type RouteCoverageAssessment,
  routeCoverageAreasKey,
  routeCoverageCatalogKey,
  routeCoverageGeometryKey,
  type SavedRegionDto,
} from '$features/prewarm';
import { formatDayClock, formatMonthDay, type ReactiveClock } from '$shared/lib';

interface Dependencies {
  route: () => Route | undefined;
  provider: () => string | null;
  online: () => boolean;
  clock: ReactiveClock;
  getRegions: (provider: string, signal: AbortSignal) => Promise<SavedRegionDto[]>;
}

export function createRouteCoverageState(deps: Dependencies) {
  let assessment = $state.raw<RouteCoverageAssessment | null>(null);
  let acceptedProvider: string | null = null;
  let verified = $state(false);
  const refreshInterval = $derived(Math.floor(deps.clock.now / 60_000));
  const route = $derived(deps.route());
  const geometryKey = $derived(route ? routeCoverageGeometryKey(route.waypoints) : undefined);
  const matches = $derived(
    assessment !== null &&
      route?.id === assessment.routeId &&
      geometryKey === assessment.geometryKey,
  );

  $effect(() => {
    const accepted = assessment;
    const provider = deps.provider();
    const online = deps.online();
    void refreshInterval;
    verified = false;
    if (accepted && (!matches || provider !== acceptedProvider)) {
      assessment = null;
      return;
    }
    if (!accepted || !matches || !provider || !online) return;
    const abort = new AbortController();
    void deps.getRegions(provider, abort.signal).then(
      (regions) => {
        if (
          abort.signal.aborted ||
          assessment !== accepted ||
          deps.provider() !== provider ||
          !deps.online()
        )
          return;
        verified =
          accepted.areasKey === routeCoverageAreasKey(regions) &&
          accepted.catalogKey === routeCoverageCatalogKey(regions);
        if (!verified) assessment = null;
      },
      () => {
        if (
          !abort.signal.aborted &&
          assessment === accepted &&
          deps.provider() === provider &&
          deps.online()
        )
          verified = false;
      },
    );
    return () => abort.abort();
  });

  return {
    accept(next: RouteCoverageAssessment | null): void {
      verified = false;
      acceptedProvider = deps.provider();
      assessment = next;
    },
    get fact(): string | undefined {
      if (
        !assessment ||
        !matches ||
        !verified ||
        !deps.online() ||
        deps.provider() !== acceptedProvider ||
        assessment.report.verdict === 'unknown'
      )
        return undefined;
      const { report, checkedAt } = assessment;
      const now = deps.clock.now;
      if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 24 * 60 * 60_000)
        return undefined;
      const verdict = report.verdict === 'complete' ? 'Complete' : 'Partial';
      return `${verdict}, checked ${formatMonthDay(checkedAt)} ${formatDayClock(checkedAt, { zone: true })}; ${report.corridorNm} nm corridor, ${report.detail} detail; ${route?.name}`;
    },
  };
}
