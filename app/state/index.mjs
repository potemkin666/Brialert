export const LIVE_FEED_URL = 'live-alerts.json';
export const GEO_LOOKUP_URL = 'data/geo-lookup.json';
export const WATCH_GEOGRAPHY_URL = 'data/watch-geography.json';
export const LONG_BRIEF_API_URL = globalThis.BRIALERT_LONG_BRIEF_API_URL || '';
export const POLL_INTERVAL_MS = 60_000;
export const SOURCE_PULL_MINUTES = 60;
export const WATCHED_STORAGE_KEY = 'brialert.watched';
export const NOTES_STORAGE_KEY = 'brialert.notes';
export const BRIEFING_MODE_STORAGE_KEY = 'brialert.briefingMode';

export function createState(watchLayerLabels) {
  return {
    alerts: [],
    activeRegion: 'all',
    activeLane: 'all',
    mapTimelineWindow: '24h',
    activeWatchLayers: new Set(Object.keys(watchLayerLabels)),
    watched: new Set(),
    lastBrowserPollAt: new Date(),
    liveFeedGeneratedAt: null,
    liveSourceCount: 0,
    liveFeedHealth: null,
    liveFeedFetchError: null,
    userLocationLabel: null,
    albertIndex: -1,
    notes: [],
    briefingMode: false,
    activeTab: 'firstalert',
    geoLookup: [],
    watchGeographySites: []
  };
}

export function createDerivedViewStore(deriveView, feedDeps) {
  let cache = null;
  let dirty = true;

  return {
    invalidate() {
      dirty = true;
    },
    current(state) {
      if (!dirty && cache) return cache;
      cache = deriveView(state, feedDeps);
      dirty = false;
      return cache;
    }
  };
}
