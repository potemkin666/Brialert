export const LIVE_FEED_URL = 'live-alerts.json';
export const GEO_LOOKUP_URL = 'data/geo-lookup.json';
export const WATCH_GEOGRAPHY_URL = 'data/watch-geography.json';
export const POLL_INTERVAL_MS = 20_000;
export const SOURCE_PULL_MINUTES = 15;
export const WATCHED_STORAGE_KEY = 'albertalert.watched';
export const NOTES_STORAGE_KEY = 'albertalert.notes';
export const SOURCE_REQUESTS_STORAGE_KEY = 'albertalert.sourceRequests';
export const BRIEFING_MODE_STORAGE_KEY = 'albertalert.briefingMode';
export const SOURCE_REQUEST_API_URL = '/api/request-source';
export const INITIAL_RESPONDER_VISIBLE = 18;
export const RESPONDER_LOAD_STEP = 16;
export const INITIAL_SUPPORTING_VISIBLE = 18;
export const SUPPORTING_LOAD_STEP = 16;
export const MAP_INIT_IDLE_TIMEOUT_MS = 1500;
export const MAP_INIT_FALLBACK_DELAY_MS = 300;

export function createState() {
  return {
    alerts: [],
    searchQuery: '',
    activeRegion: 'all',
    activeLane: 'all',
    mapViewMode: 'world',
    watched: new Set(),
    lastBrowserPollAt: new Date(),
    liveFeedGeneratedAt: null,
    liveSourceCount: 0,
    liveSourceRunStats: null,
    liveFetchedAlertCount: 0,
    liveFeedHealth: null,
    liveFeedSourceErrors: [],
    liveFeedLastRestore: null,
    liveFeedFetchError: null,
    liveFeedFetchState: 'idle',
    liveFeedLastAttemptAt: null,
    manualRefreshTriggerStatus: {
      state: 'idle',
      message: null,
      at: null,
      apiUrl: null
    },
    userLocationLabel: null,
    userLocation: null,
    albertIndex: -1,
    notes: [],
    sourceRequests: [],
    sourceRequestSubmitting: false,
    sourceRequestStatus: null,
    briefingMode: false,
    activeTab: 'firstalert',
    geoLookup: [],
    watchGeographySites: [],
    feedVisibleCount: INITIAL_RESPONDER_VISIBLE,
    supportingVisibleCount: INITIAL_SUPPORTING_VISIBLE
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
