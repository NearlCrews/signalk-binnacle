import type { RadarData, TimeBracket, WeatherGrid } from './weather-grid';
import { nearestGridTime, timeBracket } from './weather-grid';

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error' | 'stale';

export class WeatherStore {
  grid = $state.raw<WeatherGrid | undefined>(undefined);
  status = $state<WeatherStatus>('idle');
  selectedTime = $state<number>(0);
  radar = $state.raw<RadarData | undefined>(undefined);

  // The two forecast indices and blend fraction for the selected time. Overlays read this to render
  // the right step; it recomputes only when the grid or the selected time changes.
  bracket = $derived<TimeBracket>(
    this.grid ? timeBracket(this.grid, this.selectedTime) : { lo: 0, hi: 0, frac: 0 },
  );

  setStatus(status: WeatherStatus): void {
    this.status = status;
  }

  setGrid(grid: WeatherGrid, nowMs: number = Date.now()): void {
    this.grid = grid;
    this.status = 'ready';
    const first = grid.times[0];
    const last = grid.times[grid.times.length - 1];
    if (first !== undefined && (this.selectedTime < first || this.selectedTime > last)) {
      // Seed to the step nearest now, never times[0]: Open-Meteo's series starts at 00:00 of the
      // current day, so the first step is up to a day in the past and would park the slider, the
      // overlays, and the readouts on stale history at every panel open.
      this.selectedTime = nearestGridTime(grid.times, nowMs) ?? first;
    }
  }

  setSelectedTime(time: number): void {
    this.selectedTime = time;
  }

  setRadar(radar: RadarData): void {
    this.radar = radar;
  }
}
