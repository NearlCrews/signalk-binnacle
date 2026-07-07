import type { ChartGroup } from 'signalk-chart-sources';

// Seascape (https://openwaters.io/charts/seascape): a free, globally merged bathymetry service, CC BY
// 4.0. Depths are not reduced to a chart datum and do not account for tides or water level; every
// overlay built on this data carries a "for reference only" description for that reason.

export const SEASCAPE_GROUP: ChartGroup = { id: 'seascape', title: 'Seascape bathymetry' };

// Fetched from https://tiles.openwaters.io/seascape/vector.json's and raster.json's identical
// `attribution` fields on 2026-07-07. Re-fetch and update if Seascape's own attribution text changes.
const SEASCAPE_ATTRIBUTION =
  '<a href="https://openwaters.io/charts/seascape#license">© Open Water Software, LLC</a>  | <a href="https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/ITCOGT">African Great Lakes Bathymetry (GLWNB-2020): Victoria, Albert, Edward, George</a> | <a href="https://www.ausseabed.gov.au/data/bathymetry">AusBathyTopo (Australia) 2024 250 m</a> | <a href="https://tanahair.indonesia.go.id/">BATNAS Batimetri Nasional (Indonesia, ~180 m)</a> | <a href="https://doi.org/10.1594/PANGAEA.855987">Bodensee (Lake Constance) bathymetry 3 m — IGKB Tiefenschärfe</a> | <a href="https://www.ncei.noaa.gov/products/coastal-relief-model">NOAA CUDEM 1/9 arc-second (NCEI Topobathy 2014)</a> | <a href="https://www.ncei.noaa.gov/products/coastal-relief-model">NOAA CUDEM 1/3 arc-second (NCEI Topobathy 2014)</a> | <a href="https://dataforsyningen.dk/data/4707">Danmarks Dybdemodel (DDM) 50 m</a> | <a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry 2024 DTM</a> | <a href="https://www.ausseabed.gov.au/data/bathymetry">Great Barrier Reef Bathymetry 2020 30 m (gbr30)</a> | <a href="https://www.gebco.net/">GEBCO 2026 Grid (ice surface elevation)</a> | <a href="https://www.ncei.noaa.gov/products/great-lakes-bathymetry">NOAA NCEI Great Lakes Bathymetry (~90 m)</a> | <a href="https://open.canada.ca/data/en/dataset/335408ab-e7c9-581f-09fe-44487e1fd213">GSC Atlantic Bathymetric Compilation 100 m (Scotian Shelf + Newfoundland-Labrador)</a> | <a href="https://open.canada.ca/data/en/dataset/e6e11b99-f0cc-44f7-f5eb-3b995fb1637e">GSC Canada West Coast Topo-Bathymetric DEM 10 m (BC coast + Salish Sea)</a> | <a href="https://www.infomar.ie/">INFOMAR Bathymetry 10 m (merged inshore, Ireland)</a> | <a href="https://www.infomar.ie/">INFOMAR Bathymetry 25 m (merged shelf, Ireland)</a> | <a href="https://www.swisstopo.admin.ch/en/height-model-swissbathy3d">Lac Léman (Lake Geneva) Bathymetry — swissBATHY3D (~2 m)</a> | <a href="https://www.swisstopo.admin.ch/en/height-model-swissbathy3d">Lac de Neuchâtel Bathymetry — swissBATHY3D (~1 m)</a> | <a href="https://pubs.usgs.gov/dds/dds-55/pacmaps/lt_data.htm">Lake Tahoe Bathymetry (USGS DDS-55, 10 m)</a> | <a href="https://www.ncei.noaa.gov/products/estuarine-bathymetric-digital-elevation-models">NOAA NOS Estuarine Bathymetric DEMs (30 m)</a> | <a href="https://noaa-s102-pds.s3.amazonaws.com/README.html">NOAA S-102 Bathymetric Surface</a> | <a href="https://doi.org/10.1594/PANGAEA.880618">Southwest Indian Ocean Bathymetric Compilation (swIOBC) 250 m</a> | <a href="https://environment.data.gov.uk/dataset/77e6f743-d708-4909-a80f-9510b7dbaa16">SurfZone DEM 2019 (England intertidal/surf zone, 2 m)</a> | <a href="https://downloads.rijkswaterstaatdata.nl/">Vaklodingen 20 m (Dutch coastal waters, estuaries & main rivers)</a> | <a href="https://osmdata.openstreetmap.de/data/land-polygons.html">OpenStreetMap land polygons (ODbL)</a>';

export interface SeascapeDemSource {
  id: string;
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
}

// Terrarium-encoded elevation, {z}/{x}/{y}.webp tiles, global coverage, maxzoom 17. tileSize 512
// matches how Seascape's own style.json declares this source (a MapLibre raster-dem default).
export const SEASCAPE_DEM_SOURCES: SeascapeDemSource[] = [
  {
    id: 'seascape-dem',
    tiles: ['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp'],
    tileSize: 512,
    maxzoom: 17,
    attribution: SEASCAPE_ATTRIBUTION,
  },
];

export interface SeascapeVectorSource {
  id: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
}

// contours, soundings, and drying source-layers, {z}/{x}/{y}.pbf tiles, global coverage, maxzoom 14.
// Past z14 there are no new tiles; MapLibre overzooms the z14 generation, matching Seascape's own
// upstream style rather than a defect in this integration.
export const SEASCAPE_VECTOR_SOURCES: SeascapeVectorSource[] = [
  {
    id: 'seascape-vector',
    tiles: ['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.pbf'],
    maxzoom: 14,
    attribution: SEASCAPE_ATTRIBUTION,
  },
];
