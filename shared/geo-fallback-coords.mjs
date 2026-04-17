/**
 * Region-aware hard-fallback coordinates and labels.
 *
 * Imported by both the build-side geo.mjs and the client-side
 * alert-view-model.mjs so the two can never drift out of sync.
 */
export const FALLBACK_COORDS = Object.freeze({
  uk:           { lat: 54.5,    lng: -2.5 },
  london:       { lat: 51.5074, lng: -0.1278 },
  us:           { lat: 39.8283, lng: -98.5795 },
  eu:           { lat: 50,      lng: 10 },
  europe:       { lat: 50,      lng: 10 },
  international:{ lat: 50,      lng: 10 },
  _default:     { lat: 50,      lng: 10 }
});

export const FALLBACK_LOCATION_LABELS = Object.freeze({
  uk:           'United Kingdom',
  london:       'London, UK',
  us:           'United States',
  eu:           'Europe',
  europe:       'Europe',
  international:'Europe',
  _default:     'Europe'
});

/** London bounding box shared by isLondonAlert and map-watch. */
export const LONDON_BOUNDS = Object.freeze({
  latMin: 51.28, latMax: 51.70,
  lngMin: -0.52, lngMax: 0.24
});

/** World-view center & zoom used when no alerts dictate a tighter view. */
export const WORLD_VIEW_DEFAULTS = Object.freeze({
  center: Object.freeze([50, 10]),
  zoom: 4
});

export function fallbackCoordsForRegion(region) {
  return FALLBACK_COORDS[region] || FALLBACK_COORDS._default;
}

export function fallbackLocationLabelForRegion(region) {
  return FALLBACK_LOCATION_LABELS[region] || FALLBACK_LOCATION_LABELS._default;
}
