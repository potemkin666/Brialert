import { loadInitialResources, startFeedPolling } from '../feed/index.mjs';
import { syncSourceRequests } from '../feed/source-requests.mjs';
import { renderHero } from '../render/live.mjs';
import { renderSourceRequests } from '../render/source-requests.mjs';

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

export function startUserLocationDetection(state, elements) {
  return import('../utils/location.mjs').then(({ detectUserLocationLabel }) =>
    detectUserLocationLabel().then((label) => {
      if (!label) return;
      state.userLocationLabel = label;
      renderHero({ state, elements });
    }).catch((error) => {
      console.warn('Location detection skipped:', error instanceof Error ? error.message : String(error));
    })
  );
}
