import { API_BASE } from '../../shared/api-config.mjs';
import { reportBackgroundError } from '../../shared/logger.mjs';

const TRAFFIC_API_URL = `${API_BASE}/api/traffic`;
const TRAFFIC_SEEN_PREFIX = 'albertalert.traffic.seen.';

function storageGet(storage, key) {
  try {
    return storage?.getItem?.(key);
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // Ignore storage failures so analytics never breaks the app.
  }
}

function rememberEvent(storage, seenEvents, key) {
  if (!key) return false;
  if (seenEvents.has(key)) return false;
  if (storageGet(storage, key) === '1') {
    seenEvents.add(key);
    return false;
  }
  seenEvents.add(key);
  storageSet(storage, key, '1');
  return true;
}

function currentTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function basePayload(state, { locationRef, navigatorRef, documentRef, windowRef, screenRef }) {
  return {
    path: locationRef?.pathname || '/',
    tab: state?.activeTab || null,
    mapMode: state?.mapViewMode || null,
    referrer: documentRef?.referrer || '',
    language: navigatorRef?.language || '',
    timezone: currentTimezone(),
    viewportWidth: windowRef?.innerWidth,
    viewportHeight: windowRef?.innerHeight,
    screenWidth: screenRef?.width,
    screenHeight: screenRef?.height
  };
}

export function createTrafficReporter({
  apiUrl = TRAFFIC_API_URL,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  sessionStorageRef = globalThis.sessionStorage,
  locationRef = globalThis.location,
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  screenRef = globalThis.screen
} = {}) {
  const seenEvents = new Set();

  async function send(eventType, state, overrides = {}, dedupeKey = '') {
    if (!fetchImpl || !apiUrl) return;
    const sessionKey = `${TRAFFIC_SEEN_PREFIX}${dedupeKey}`;
    if (!rememberEvent(sessionStorageRef, seenEvents, sessionKey)) return;

    try {
      await fetchImpl(apiUrl, {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          ...basePayload(state, { locationRef, navigatorRef, documentRef, windowRef, screenRef }),
          ...overrides
        })
      });
    } catch (error) {
      reportBackgroundError('traffic', `send ${eventType} failed`, error, { apiUrl, eventType, dedupeKey });
    }
  }

  return {
    trackPageView(state) {
      return send('page_view', state, {}, `page:${locationRef?.pathname || '/'}`);
    },
    trackTabView(state, tab) {
      if (!tab) return Promise.resolve();
      return send('tab_view', state, { tab }, `tab:${tab}`);
    },
    trackMapMode(state, mapMode) {
      if (!mapMode) return Promise.resolve();
      return send('map_mode', state, { mapMode }, `map:${mapMode}`);
    }
  };
}
