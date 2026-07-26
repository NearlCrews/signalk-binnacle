import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre computes its worker filename at runtime, so Vite cannot discover and emit it
// automatically. The explicit worker import emits the asset; this call must precede every Map.
setWorkerUrl(workerUrl);
