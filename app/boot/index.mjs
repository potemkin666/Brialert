import { albertQuotes, defaultNotes } from '../../shared/ui-data.mjs';
import { normaliseAlert, sortAlertsByFreshness } from '../../shared/alert-view-model.mjs';
import { deriveView } from '../../shared/feed-controller.mjs';
import { createMapController } from '../../shared/map-watch.mjs';
import {
  applyBriefingMode as syncBriefingMode,
  loadArray,
  loadSet,
  nextAlbertQuote,
  saveArray,
  saveSet,
  setActiveTab as applyTabState
} from '../../shared/persistence-ui.mjs';
import { MAP_VIEW_MODES } from '../../shared/ui-constants.mjs';
import { createModalRuntime } from '../render/modal.mjs';
import {
  BRIEFING_MODE_STORAGE_KEY,
  GEO_LOOKUP_URL,
  MAP_INIT_FALLBACK_DELAY_MS,
  MAP_INIT_IDLE_TIMEOUT_MS,
  LIVE_FEED_URL,
  NOTES_STORAGE_KEY,
  POLL_INTERVAL_MS,
  SOURCE_REQUEST_API_URL,
  SOURCE_REQUESTS_STORAGE_KEY,
  WATCHED_STORAGE_KEY,
  WATCH_GEOGRAPHY_URL,
  createDerivedViewStore,
  createState
} from '../state/index.mjs';
import { applyDeviceProfile } from '../utils/device.mjs';
import { createElements } from './elements.mjs';
import { createRenderingCoordinator } from './rendering.mjs';
import { bindEvents } from './events.mjs';
import * as actions from './actions.mjs';
import { bootstrapMap, startRuntimeLifecycle, startUserLocationDetection } from './startup.mjs';
import { filteredMapView } from '../render/map.mjs';
import { renderSourceRequests } from '../render/source-requests.mjs';

export function initialiseApp() {
  const state = createState();
  const derivedViewStore = createDerivedViewStore(deriveView, { sortAlertsByFreshness });
  const elements = createElements();

  let modalController = null;
  function syncModalWatchToggle() {
    const button = elements.modalWatchToggle;
    if (!button) return;
    const alert = modalController?.getCurrentAlert?.() || null;
    if (!alert) {
      button.disabled = true;
      button.classList.remove('active');
      button.textContent = 'Follow story';
      return;
    }
    const isWatching = state.watched.has(alert.id);
    button.disabled = false;
    button.classList.toggle('active', isWatching);
    button.textContent = isWatching ? 'Following story' : 'Follow story';
  }

  const modalRuntime = createModalRuntime(elements, { onAlertChange: syncModalWatchToggle });
  modalController = modalRuntime.modalController;

  const mapController = createMapController({
    mapElement: elements.mapElement,
    mapStatusLine: elements.mapStatusLine,
    mapEmptyState: elements.mapEmptyState,
    openDetail: modalController.openDetail
  });

  function setActiveTab(next) {
    actions.setActiveTabState(state, next);
    applyTabState(next, { tabbar: elements.tabbar }, {
      onTabChange(tab) {
        if (tab === 'map') {
          setTimeout(() => {
            mapController.ensureMap();
            mapController.renderMap(state, filteredMapView(state, rendering.currentView()), true);
            mapController.invalidateSize();
          }, 60);
        }
      }
    });
  }

  function applyBriefingMode() {
    syncBriefingMode(state.briefingMode, { screen: elements.screen }, {
      setActiveTab,
      closeDetailPanel: modalController.closeDetailPanel
    });
  }

  function refreshAlbertQuote() {
    const next = nextAlbertQuote(albertQuotes, state.albertIndex);
    state.albertIndex = next.index;
    elements.albertQuote.textContent = next.quote;
  }

  const rendering = createRenderingCoordinator({
    state,
    elements,
    modalController,
    mapController,
    derivedViewStore,
    saveSet,
    watchedStorageKey: WATCHED_STORAGE_KEY,
    syncModalWatchToggle
  });

  bindEvents({
    state,
    elements,
    mapController,
    modalController,
    generateLongBrief: modalRuntime.generateLongBrief,
    saveArray,
    saveSet,
    notesStorageKey: NOTES_STORAGE_KEY,
    sourceRequestsStorageKey: SOURCE_REQUESTS_STORAGE_KEY,
    watchedStorageKey: WATCHED_STORAGE_KEY,
    sourceRequestApiUrl: SOURCE_REQUEST_API_URL,
    actions,
    rendering,
    setActiveTab
  });

  applyDeviceProfile();
  bootstrapMap(mapController, {
    idleTimeoutMs: MAP_INIT_IDLE_TIMEOUT_MS,
    fallbackDelayMs: MAP_INIT_FALLBACK_DELAY_MS
  });

  state.watched = loadSet(WATCHED_STORAGE_KEY);
  state.notes = loadArray(NOTES_STORAGE_KEY, defaultNotes);
  state.sourceRequests = loadArray(SOURCE_REQUESTS_STORAGE_KEY, []);
  state.briefingMode = false;
  state.mapViewMode = state.mapViewMode || MAP_VIEW_MODES.london;

  refreshAlbertQuote();
  applyBriefingMode();
  rendering.renderAll();
  startUserLocationDetection(state, elements);

  startRuntimeLifecycle({
    state,
    urls: {
      liveFeedUrl: LIVE_FEED_URL,
      geoLookupUrl: GEO_LOOKUP_URL,
      watchGeographyUrl: WATCH_GEOGRAPHY_URL,
      sourceRequestApiUrl: SOURCE_REQUEST_API_URL
    },
    pollIntervalMs: POLL_INTERVAL_MS,
    normaliseAlert,
    invalidateDerivedView: rendering.invalidateDerivedView,
    renderAll: rendering.renderAll,
    renderSourceRequestsWithState: () => renderSourceRequests({ state, elements }),
    saveSourceRequests: () => saveArray(SOURCE_REQUESTS_STORAGE_KEY, state.sourceRequests)
  });

  elements.albertCard?.addEventListener('click', refreshAlbertQuote);
  document.querySelector('.bulldog-card')?.addEventListener('dblclick', () => {
    elements.albertNote.classList.toggle('hidden');
  });
}
