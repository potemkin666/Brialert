import { loadInitialResources, refreshLiveFeedNow, startFeedPolling } from '../feed/index.mjs';
import { syncSourceRequests } from '../feed/source-requests.mjs';

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
