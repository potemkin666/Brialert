import { albertQuotes, defaultNotes } from '../../shared/ui-data.mjs';
import {
  normaliseAlert,
  sortAlertsByFreshness
} from '../../shared/alert-view-model.mjs';
import { deriveView } from '../../shared/feed-controller.mjs';
import { createMapController } from '../../shared/map-watch.mjs';
import {
  applyBriefingMode as syncBriefingMode,
  loadArray,
  loadBoolean,
  loadSet,
  nextAlbertQuote,
  saveArray,
  saveBoolean,
  saveSet,
  setActiveTab as applyTabState
} from '../../shared/persistence-ui.mjs';
import { loadInitialResources, startFeedPolling } from '../feed/index.mjs';
import { submitSourceRequest, syncSourceRequests } from '../feed/source-requests.mjs';
import { filteredMapView, renderMapIfActive } from '../render/map.mjs';
import { createModalRuntime } from '../render/modal.mjs';
import { renderBriefingMode, renderFeed, renderHero, renderPriority, renderSupporting } from '../render/live.mjs';
import { renderNotes, renderWatchlist } from '../render/notes.mjs';
import { renderSourceRequests } from '../render/source-requests.mjs';
import {
  BRIEFING_MODE_STORAGE_KEY,
  GEO_LOOKUP_URL,
  MAP_INIT_FALLBACK_DELAY_MS,
  MAP_INIT_IDLE_TIMEOUT_MS,
  INITIAL_RESPONDER_VISIBLE,
  INITIAL_SUPPORTING_VISIBLE,
  LIVE_FEED_URL,
  NOTES_STORAGE_KEY,
  POLL_INTERVAL_MS,
  RESPONDER_LOAD_STEP,
  SOURCE_REQUEST_API_URL,
  SOURCE_REQUESTS_STORAGE_KEY,
  SUPPORTING_LOAD_STEP,
  WATCHED_STORAGE_KEY,
  WATCH_GEOGRAPHY_URL,
  createDerivedViewStore,
  createState
} from '../state/index.mjs';
import { applyDeviceProfile } from '../utils/device.mjs';
import { detectUserLocationLabel } from '../utils/location.mjs';

function createElements() {
  return {
    priorityCard: document.getElementById('priority-card'),
    responderSection: document.getElementById('responder-section'),
    screen: document.querySelector('.screen'),
    feedList: document.getElementById('feed-list'),
    feedLoadMore: document.getElementById('feed-load-more'),
    supportingList: document.getElementById('supporting-list'),
    supportingLoadMore: document.getElementById('supporting-load-more'),
    watchlistList: document.getElementById('watchlist-list'),
    notesList: document.getElementById('notes-list'),
    watchedCount: document.getElementById('watched-count'),
    supportingCount: document.getElementById('supporting-count'),
    watchlistSummary: document.getElementById('watchlist-summary'),
    heroSearch: document.getElementById('hero-search'),
    heroUpdated: document.getElementById('hero-updated'),
    mapElement: document.getElementById('leaflet-map'),
    mapPanelSurface: document.getElementById('map-panel-surface'),
    mapStatusLine: document.getElementById('map-status-line'),
    mapEmptyState: document.getElementById('map-empty-state'),
    mapModeTabs: document.getElementById('map-mode-tabs'),
    filters: document.getElementById('filters'),
    tabbar: document.getElementById('tabbar'),
    briefingModePanel: document.getElementById('briefing-mode-panel'),
    briefingModeTitle: document.getElementById('briefing-mode-title'),
    briefingModeMeta: document.getElementById('briefing-mode-meta'),
    briefingModeSummary: document.getElementById('briefing-mode-summary'),
    briefingModeCopy: document.getElementById('briefing-mode-copy'),
    albertCard: document.getElementById('albert-card'),
    albertQuote: document.getElementById('albert-quote'),
    albertNote: document.getElementById('albert-note'),
    modal: document.getElementById('detail-modal'),
    closeModal: document.getElementById('close-modal'),
    copyBriefing: document.getElementById('copy-briefing'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modalTitle: document.getElementById('modal-title'),
    modalMeta: document.getElementById('modal-meta'),
    modalAiSummary: document.getElementById('modal-ai-summary'),
    modalSummary: document.getElementById('modal-summary'),
    modalSceneClock: document.getElementById('modal-scene-clock'),
    modalConfidenceLadder: document.getElementById('modal-confidence-ladder'),
    modalAudit: document.getElementById('modal-audit'),
    modalCorroboration: document.getElementById('modal-corroboration'),
    sceneClockPanel: document.getElementById('scene-clock-panel'),
    confidenceLadderPanel: document.getElementById('confidence-ladder-panel'),
    auditPanel: document.getElementById('audit-panel'),
    corroborationPanel: document.getElementById('corroboration-panel'),
    modalSeverity: document.getElementById('modal-severity'),
    modalStatus: document.getElementById('modal-status'),
    modalSource: document.getElementById('modal-source'),
    modalRegion: document.getElementById('modal-region'),
    modalBriefing: document.getElementById('modal-briefing'),
    modalLink: document.getElementById('modal-link'),
    modalWatchToggle: document.getElementById('modal-watch-toggle'),
    expandedBriefPanel: document.getElementById('expanded-brief-panel'),
    modalExpandedBrief: document.getElementById('modal-expanded-brief'),
    generateExpandedBrief: document.getElementById('generate-expanded-brief'),
    copyExpandedBrief: document.getElementById('copy-expanded-brief'),
    noteForm: document.getElementById('note-form'),
    noteTitle: document.getElementById('note-title'),
    noteBody: document.getElementById('note-body'),
    sourceRequestForm: document.getElementById('source-request-form'),
    sourceRequestUrl: document.getElementById('source-request-url'),
    sourceRequestSubmit: document.getElementById('source-request-submit'),
    sourceRequestStatus: document.getElementById('source-request-status'),
    sourceRequestList: document.getElementById('source-request-list'),
    sourceRequestCount: document.getElementById('source-request-count'),
    sourceRequestHint: document.getElementById('source-request-hint')
  };
}

export function initialiseApp() {
  const state = createState();
  const feedDeps = {
    sortAlertsByFreshness
  };
  const derivedViewStore = createDerivedViewStore(deriveView, feedDeps);
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
  const { generateLongBrief } = modalRuntime;
  const mapController = createMapController({
    mapElement: elements.mapElement,
    mapStatusLine: elements.mapStatusLine,
    mapEmptyState: elements.mapEmptyState,
    openDetail: modalController.openDetail
  });
  let resizeTimer = null;
  let searchTimer = null;

  const invalidateDerivedView = () => derivedViewStore.invalidate();
  const currentView = () => derivedViewStore.current(state);

  function setActiveTab(next) {
    state.activeTab = next;
    applyTabState(next, { tabbar: elements.tabbar }, {
      onTabChange(tab) {
        if (tab === 'map') {
          setTimeout(() => {
            mapController.ensureMap();
            mapController.renderMap(state, filteredMapView(state, currentView()), true);
            mapController.invalidateSize();
          }, 60);
        }
      }
    });
  }

  function applyBriefingMode() {
    syncBriefingMode(state.briefingMode, {
      screen: elements.screen
    }, {
      setActiveTab,
      closeDetailPanel: modalController.closeDetailPanel
    });
  }

  function renderAll() {
    const view = currentView();
    renderHero({ state, elements });
    renderBriefingMode({ state, elements, view, modalController });
    renderPriority({ state, elements, view, modalController });
    renderFeed({
      state,
      elements,
      view,
      modalController,
      invalidateDerivedView,
      renderAll,
      saveSet,
      watchedStorageKey: WATCHED_STORAGE_KEY
    });
    renderSupporting({ elements, view, state, modalController });
    renderMapIfActive({ state, view, mapController });
    renderWatchlist({ state, elements, modalController });
    renderNotes({ state, elements });
    renderSourceRequests({ state, elements });
    syncModalWatchToggle();
  }

  function refreshAlbertQuote() {
    const next = nextAlbertQuote(albertQuotes, state.albertIndex);
    state.albertIndex = next.index;
    elements.albertQuote.textContent = next.quote;
  }

  function bindEvents() {
    elements.filters?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-region]');
      if (!button) return;
      state.activeRegion = button.dataset.region;
      invalidateDerivedView();
      state.feedVisibleCount = INITIAL_RESPONDER_VISIBLE;
      state.supportingVisibleCount = INITIAL_SUPPORTING_VISIBLE;
      elements.filters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderAll();
    });

    elements.feedLoadMore?.addEventListener('click', () => {
      state.feedVisibleCount += RESPONDER_LOAD_STEP;
      renderAll();
    });

    elements.supportingLoadMore?.addEventListener('click', () => {
      state.supportingVisibleCount += SUPPORTING_LOAD_STEP;
      renderAll();
    });

    elements.heroSearch?.addEventListener('input', (event) => {
      const nextQuery = String(event.target?.value || '');
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchQuery = nextQuery;
        invalidateDerivedView();
        renderAll();
      }, 80);
    });
    elements.tabbar?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      setActiveTab(button.dataset.tab);
    });

    elements.noteForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!elements.noteTitle || !elements.noteBody) return;
      const title = elements.noteTitle.value.trim();
      const body = elements.noteBody.value.trim();
      if (!title || !body) return;
      state.notes.unshift({ title, body });
      saveArray(NOTES_STORAGE_KEY, state.notes);
      elements.noteTitle.value = '';
      elements.noteBody.value = '';
      renderNotes({ state, elements });
    });

    elements.sourceRequestForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const url = String(elements.sourceRequestUrl?.value || '').trim();
      if (!url) return;
      state.sourceRequestSubmitting = true;
      state.sourceRequestStatus = {
        kind: 'info',
        message: 'Validating source and queuing it for the next run...'
      };
      renderSourceRequests({ state, elements });
      try {
        const regionHint = state.activeRegion === 'all' ? 'uk' : state.activeRegion;
        const payload = await submitSourceRequest(state, {
          apiUrl: SOURCE_REQUEST_API_URL,
          url,
          regionHint
        });
        saveArray(SOURCE_REQUESTS_STORAGE_KEY, state.sourceRequests);
        state.sourceRequestStatus = {
          kind: 'success',
          message: payload?.detail || 'Source validated and queued for the next run.'
        };
        if (elements.sourceRequestUrl) elements.sourceRequestUrl.value = '';
      } catch (error) {
        state.sourceRequestStatus = {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error)
        };
      } finally {
        state.sourceRequestSubmitting = false;
        renderSourceRequests({ state, elements });
      }
    });

    elements.copyBriefing?.addEventListener('click', async () => {
      const briefing = elements.copyBriefing.dataset.briefing || '';
      if (!briefing) return;
      await modalController.copyTextToButton(briefing, elements.copyBriefing, 'Copy Briefing');
    });

    elements.modalWatchToggle?.addEventListener('click', () => {
      const alert = modalController.getCurrentAlert();
      if (!alert) return;
      if (state.watched.has(alert.id)) state.watched.delete(alert.id);
      else state.watched.add(alert.id);
      saveSet(WATCHED_STORAGE_KEY, state.watched);
      invalidateDerivedView();
      renderAll();
    });

    elements.generateExpandedBrief?.addEventListener('click', generateLongBrief);
    elements.copyExpandedBrief?.addEventListener('click', async () => {
      const brief = elements.copyExpandedBrief.dataset.brief || '';
      if (!brief) return;
      await modalController.copyTextToButton(brief, elements.copyExpandedBrief, 'Copy Long Brief');
    });

    elements.briefingModeCopy?.addEventListener('click', async () => {
      const briefing = elements.briefingModeCopy.dataset.briefing || '';
      if (!briefing) return;
      await modalController.copyTextToButton(briefing, elements.briefingModeCopy, 'Copy Briefing');
    });

    elements.closeModal?.addEventListener('click', modalController.closeDetailPanel);
    elements.modalBackdrop?.addEventListener('click', modalController.closeDetailPanel);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') modalController.closeDetailPanel();
    });

    elements.mapModeTabs?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-map-mode]');
      if (!button) return;
      const nextMode = button.dataset.mapMode === 'world' ? 'world' : 'london';
      if (state.mapViewMode === nextMode) return;
      state.mapViewMode = nextMode;
      elements.mapModeTabs.querySelectorAll('[data-map-mode]').forEach((item) => {
        const active = item.dataset.mapMode === nextMode;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      if (elements.mapPanelSurface) {
        elements.mapPanelSurface.setAttribute('aria-labelledby', nextMode === 'world' ? 'map-mode-world-tab' : 'map-mode-london-tab');
      }
      mapController.renderMap(state, filteredMapView(state, currentView()), true);
      mapController.invalidateSize();
    });

    window.addEventListener('resize', () => {
      applyDeviceProfile();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => mapController.invalidateSize(), 120);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => mapController.invalidateSize(), 120);
      });
    }

    elements.albertCard?.addEventListener('click', refreshAlbertQuote);
    document.querySelector('.bulldog-card')?.addEventListener('dblclick', () => {
      elements.albertNote.classList.toggle('hidden');
    });
  }

  applyDeviceProfile();
  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => mapController.ensureMap(), { timeout: MAP_INIT_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(() => mapController.ensureMap(), MAP_INIT_FALLBACK_DELAY_MS);
  }
  state.watched = loadSet(WATCHED_STORAGE_KEY);
  state.notes = loadArray(NOTES_STORAGE_KEY, defaultNotes);
  state.sourceRequests = loadArray(SOURCE_REQUESTS_STORAGE_KEY, []);
  state.briefingMode = false;

  refreshAlbertQuote();
  applyBriefingMode();
  renderAll();
  bindEvents();
  detectUserLocationLabel().then((label) => {
    if (!label) return;
    state.userLocationLabel = label;
    renderHero({ state, elements });
  }).catch((error) => {
    console.warn('Location detection skipped:', error instanceof Error ? error.message : String(error));
  });

  loadInitialResources(
    state,
    {
      liveFeedUrl: LIVE_FEED_URL,
      geoLookupUrl: GEO_LOOKUP_URL,
      watchGeographyUrl: WATCH_GEOGRAPHY_URL
    },
    normaliseAlert,
    () => {
      invalidateDerivedView();
      renderAll();
    }
  );

  startFeedPolling(state, POLL_INTERVAL_MS, LIVE_FEED_URL, normaliseAlert, () => {
    invalidateDerivedView();
    renderAll();
  });

  syncSourceRequests(state, SOURCE_REQUEST_API_URL, () => {
    saveArray(SOURCE_REQUESTS_STORAGE_KEY, state.sourceRequests);
    renderSourceRequests({ state, elements });
  });
}
