export { default as InstrumentsPanel } from './InstrumentsPanel.svelte';
export { discoverBatteries, discoverInstrumentInstances } from './instance-discovery';
export type { InstrumentsController, InstrumentsDeps } from './instruments-controller.svelte';
export { createInstrumentsController } from './instruments-controller.svelte';
export { detectKip, KIP_URL } from './kip-launcher';
export type { TileCategory, TileDef, TileDeps, TileReading } from './tile-catalog';
export { batteryTileDef, CLIENT_DEFAULT_ZONES, DEFAULT_TILES, TILE_CATALOG } from './tile-catalog';
