// Tile styles a story can pick with "basemap" in story.json.
// Modern stories want town labels; ancient ones should use a label-free relief map.
// All of these work without an API key.
// theme: tells the CSS whether map labels and overlays sit on a dark or light map.
// opacity + background: tiles are drawn semi-transparent over a colour to tint them.

const ESRI = 'Tiles &copy; Esri';
const ESRI_ROOT = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const BASEMAPS = {
  'esri-dark': {
    base: `${ESRI_ROOT}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI_ROOT}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI} &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors`,
    maxZoom: 16,
    theme: 'dark',
    // Semi-transparent tiles over a slate background lift the near-black
    // map to a softer mid-tone, far cheaper than a CSS filter.
    opacity: 0.68,
    background: '#6a7587',
  },
  // Quiet light grey with place names: lets coloured front lines stand out.
  'esri-light': {
    base: `${ESRI_ROOT}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI_ROOT}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI} &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors`,
    maxZoom: 16,
    theme: 'light',
  },
  osm: {
    base: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    labels: null,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    theme: 'light',
  },
  // No modern labels: suits Rome, Carthage, the Aztecs. The grey relief
  // over a parchment background reads as an old map.
  'esri-relief': {
    base: `${ESRI_ROOT}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`,
    labels: null,
    attribution: `${ESRI} &mdash; Esri, USGS, NOAA`,
    maxNativeZoom: 13,
    maxZoom: 16,
    theme: 'light',
    opacity: 0.72,
    background: '#e3d2a8',
  },
};
