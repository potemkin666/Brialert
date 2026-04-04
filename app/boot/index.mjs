import { watchLayerLabels, albertQuotes, defaultNotes } from '../../shared/ui-data.mjs';
import {
  isQuarantineCandidate,
  isTerrorRelevant,
  isLiveIncidentCandidate,
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
import { filteredMapView, renderMapIfActive } from '../render/map.mjs';
import { createModalRuntime } from '../render/modal.mjs';
import {
  renderBriefingMode,
  renderContext,
  renderFeed,
  renderHero,
  renderPriority,
  renderQuarantine
} from '../render/live.mjs';
import { renderNotes, renderWatchlist } from '../render/notes.mjs';
import {
  BRIEFING_MODE_STORAGE_KEY,
  CONTEXT_LOAD_STEP,
  GEO_LOOKUP_URL,
  INITIAL_CONTEXT_VISIBLE,
  MAP_INIT_FALLBACK_DELAY_MS,
  MAP_INIT_IDLE_TIMEOUT_MS,
  INITIAL_QUARANTINE_VISIBLE,
  INITIAL_RESPONDER_VISIBLE,
  LIVE_FEED_URL,
  NOTES_STORAGE_KEY,
  POLL_INTERVAL_MS,
  QUARANTINE_LOAD_STEP,
  RESPONDER_LOAD_STEP,
  SOURCE_PULL_MINUTES,
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
    contextList: document.getElementById('context-list'),
    contextLoadMore: document.getElementById('context-load-more'),
    quarantineList: document.getElementById('quarantine-list'),
    quarantineLoadMore: document.getElementById('quarantine-load-more'),
    watchlistList: document.getElementById('watchlist-list'),
    notesList: document.getElementById('notes-list'),
    watchedCount: document.getElementById('watched-count'),
    contextCount: document.getElementById('context-count'),
    quarantineCount: document.getElementById('quarantine-count'),
    watchlistSummary: document.getElementById('watchlist-summary'),
    heroSearch: document.getElementById('hero-search'),
    heroUpdated: document.getElementById('hero-updated'),
    mapElement: document.getElementById('leaflet-map'),
    mapSummary: document.getElementById('map-summary'),
    mapPostureChip: document.getElementById('map-posture-chip'),
    mapLayerSummary: document.getElementById('map-layer-summary'),
    mapTimelineFilters: document.getElementById('map-timeline-filters'),
    mapZoomIn: document.getElementById('map-zoom-in'),
    mapZoomOut: document.getElementById('map-zoom-out'),
    mapReset: document.getElementById('map-reset'),
    mapLayerToggles: document.getElementById('map-layer-toggles'),
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
    expandedBriefPanel: document.getElementById('expanded-brief-panel'),
    modalExpandedBrief: document.getElementById('modal-expanded-brief'),
    generateExpandedBrief: document.getElementById('generate-expanded-brief'),
    copyExpandedBrief: document.getElementById('copy-expanded-brief'),
    noteForm: document.getElementById('note-form'),
    noteTitle: document.getElementById('note-title'),
    noteBody: document.getElementById('note-body')
  };
}

export function initialiseApp() {
  const state = createState(watchLayerLabels);
  const feedDeps = {
    sortAlertsByFreshness,
    isLiveIncidentCandidate,
    isQuarantineCandidate,
    isTerrorRelevant
  };
  const derivedViewStore = createDerivedViewStore(deriveView, feedDeps);
  const elements = createElements();
  const { modalController, generateLongBrief } = createModalRuntime(elements);
  const mapController = createMapController({
    mapElement: elements.mapElement,
    mapSummary: elements.mapSummary,
    mapPostureChip: elements.mapPostureChip,
    mapLayerSummary: elements.mapLayerSummary,
    watchLayerLabels,
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
    renderContext({ elements, view, state, modalController });
    renderQuarantine({ elements, view, state, modalController });
    renderMapIfActive({ state, view, mapController });
    renderWatchlist({ state, elements, modalController });
    renderNotes({ state, elements });
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
      state.contextVisibleCount = INITIAL_CONTEXT_VISIBLE;
      state.quarantineVisibleCount = INITIAL_QUARANTINE_VISIBLE;
      elements.filters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderAll();
    });

    elements.feedLoadMore?.addEventListener('click', () => {
      state.feedVisibleCount += RESPONDER_LOAD_STEP;
      renderAll();
    });

    elements.contextLoadMore?.addEventListener('click', () => {
      state.contextVisibleCount += CONTEXT_LOAD_STEP;
      renderAll();
    });

    elements.quarantineLoadMore?.addEventListener('click', () => {
      state.quarantineVisibleCount += QUARANTINE_LOAD_STEP;
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

    elements.copyBriefing?.addEventListener('click', async () => {
      const briefing = elements.copyBriefing.dataset.briefing || '';
      if (!briefing) return;
      await modalController.copyTextToButton(briefing, elements.copyBriefing, 'Copy Briefing');
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

    elements.mapZoomIn?.addEventListener('click', () => mapController.zoomMap(1));
    elements.mapZoomOut?.addEventListener('click', () => mapController.zoomMap(-1));
    elements.mapReset?.addEventListener('click', () => mapController.renderMap(state, filteredMapView(state, currentView()), true));

    elements.mapTimelineFilters?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-map-window]');
      if (!button) return;
      state.mapTimelineWindow = button.dataset.mapWindow || '24h';
      elements.mapTimelineFilters.querySelectorAll('[data-map-window]').forEach((item) => {
        item.classList.toggle('active', item.dataset.mapWindow === state.mapTimelineWindow);
      });
      mapController.renderMap(state, filteredMapView(state, currentView()), true);
    });

    elements.mapLayerToggles?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-watch-layer]');
      if (!button) return;
      const layer = button.dataset.watchLayer;
      if (state.activeWatchLayers.has(layer)) state.activeWatchLayers.delete(layer);
      else state.activeWatchLayers.add(layer);
      button.classList.toggle('active', state.activeWatchLayers.has(layer));
      mapController.renderMap(state, filteredMapView(state, currentView()), true);
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
}
