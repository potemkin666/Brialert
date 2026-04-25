import {
  loadInitialResources,
  refreshLiveFeedNow,
  refreshLiveFeedUntilUpdated,
  startFeedPolling
} from '../feed/index.mjs';
import { syncSourceRequests } from '../feed/source-requests.mjs';
import { startLondonWeatherPolling } from '../weather/index.mjs';

export function bootstrapMap(mapController, { idleTimeoutMs, fallbackDelayMs }) {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => mapController.ensureMap(), { timeout: idleTimeoutMs });
  } else {
    setTimeout(() => mapController.ensureMap(), fallbackDelayMs);
  }
}

export function startRuntimeLifecycle({
  state,
  urls,
  pollIntervalMs,
  weatherPollIntervalMs,
  normaliseAlert,
  invalidateDerivedView,
  renderAll,
  renderSourceRequestsWithState,
  saveSourceRequests
}) {
  loadInitialResources(
    state,
    {
      liveFeedUrl: urls.liveFeedUrl,
      geoLookupUrl: urls.geoLookupUrl,
      watchGeographyUrl: urls.watchGeographyUrl
    },
    normaliseAlert,
    () => {
      invalidateDerivedView();
      renderAll();
    }
  );

  startFeedPolling(state, pollIntervalMs, urls.liveFeedUrl, normaliseAlert, () => {
    invalidateDerivedView();
    renderAll();
  });

  startLondonWeatherPolling(state, weatherPollIntervalMs, () => {
    renderAll();
  });

  syncSourceRequests(state, urls.sourceRequestApiUrl, () => {
    saveSourceRequests();
    renderSourceRequestsWithState();
  });
}

export function refreshFeed({
  state,
  liveFeedUrl,
  normaliseAlert,
  invalidateDerivedView,
  renderAll
}) {
  return refreshLiveFeedNow(state, liveFeedUrl, normaliseAlert, () => {
    invalidateDerivedView();
    renderAll();
  });
}

export function refreshFeedUntilUpdated({
  state,
  liveFeedUrl,
  normaliseAlert,
  invalidateDerivedView,
  renderAll,
  previousGeneratedAt
}) {
  return refreshLiveFeedUntilUpdated(
    state,
    liveFeedUrl,
    normaliseAlert,
    () => {
      invalidateDerivedView();
      renderAll();
    },
    { previousGeneratedAt }
  );
}
