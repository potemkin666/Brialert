import { submitSourceRequest } from '../feed/source-requests.mjs';
import { filteredMapView } from '../render/map.mjs';
import { renderNotes } from '../render/notes.mjs';
import { renderSourceRequests } from '../render/source-requests.mjs';
import { applyDeviceProfile } from '../utils/device.mjs';
import { MAP_VIEW_MODES, REGION_ALL, SOURCE_REQUEST_STATUS_KINDS } from '../../shared/ui-constants.mjs';

export function bindEvents({
  state,
  elements,
  mapController,
  modalController,
  generateLongBrief,
  saveArray,
  saveSet,
  notesStorageKey,
  sourceRequestsStorageKey,
  watchedStorageKey,
  sourceRequestApiUrl,
  actions,
  rendering,
  setActiveTab,
  triggerLiveFeedRun,
  refreshFeedNow
}) {
  let resizeTimer = null;
  let searchTimer = null;

  elements.filters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-region]');
    if (!button) return;
    actions.setActiveRegion(state, button.dataset.region);
    rendering.invalidateDerivedView();
    elements.filters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    rendering.renderAll();
  });

  elements.feedLoadMore?.addEventListener('click', () => {
    actions.incrementResponderVisible(state);
    rendering.renderAll();
  });

  elements.supportingLoadMore?.addEventListener('click', () => {
    actions.incrementSupportingVisible(state);
    rendering.renderAll();
  });

  elements.heroSearch?.addEventListener('input', (event) => {
    const nextQuery = String(event.target?.value || '');
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      actions.setSearchQuery(state, nextQuery);
      rendering.invalidateDerivedView();
      rendering.renderAll();
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
    saveArray(notesStorageKey, state.notes);
    elements.noteTitle.value = '';
    elements.noteBody.value = '';
    renderNotes({ state, elements });
  });

  elements.sourceRequestForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = String(elements.sourceRequestUrl?.value || '').trim();
    if (!url) return;
    actions.setSourceRequestSubmitting(state, true);
    actions.setSourceRequestStatus(state, {
      kind: SOURCE_REQUEST_STATUS_KINDS.info,
      message: 'Validating source and queuing it for the next run...'
    });
    renderSourceRequests({ state, elements });
    try {
      const regionHint = state.activeRegion === REGION_ALL ? 'uk' : state.activeRegion;
      const payload = await submitSourceRequest(state, {
        apiUrl: sourceRequestApiUrl,
        url,
        regionHint
      });
      saveArray(sourceRequestsStorageKey, state.sourceRequests);
      actions.setSourceRequestStatus(state, {
        kind: SOURCE_REQUEST_STATUS_KINDS.success,
        message: payload?.detail || 'Source validated and queued for the next run.'
      });
      if (elements.sourceRequestUrl) elements.sourceRequestUrl.value = '';
    } catch (error) {
      actions.setSourceRequestStatus(state, {
        kind: SOURCE_REQUEST_STATUS_KINDS.error,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      actions.setSourceRequestSubmitting(state, false);
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
    actions.toggleWatchedAlert(state, alert.id);
    saveSet(watchedStorageKey, state.watched);
    rendering.invalidateDerivedView();
    rendering.renderAll();
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
    const nextMode = button.dataset.mapMode === MAP_VIEW_MODES.world ? MAP_VIEW_MODES.world : MAP_VIEW_MODES.london;
    if (state.mapViewMode === nextMode) return;
    actions.setMapViewMode(state, nextMode);
    elements.mapModeTabs.querySelectorAll('[data-map-mode]').forEach((item) => {
      const active = item.dataset.mapMode === nextMode;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (elements.mapPanelSurface) {
      elements.mapPanelSurface.setAttribute('aria-labelledby', nextMode === MAP_VIEW_MODES.world ? 'map-mode-world-tab' : 'map-mode-london-tab');
    }
    mapController.renderMap(state, filteredMapView(state, rendering.currentView()), true);
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

  elements.heroRefresh?.addEventListener('click', async () => {
    if (elements.heroRefresh.disabled) return;
    const originalText = elements.heroRefresh.textContent;
    elements.heroRefresh.disabled = true;
    elements.heroRefresh.textContent = 'Queuing run...';
    state.manualRefreshTriggerStatus = {
      state: 'pending',
      message: null,
      at: new Date().toISOString(),
      apiUrl: null
    };
    rendering.renderAll();
    try {
      try {
        const triggerResult = await triggerLiveFeedRun();
        state.manualRefreshTriggerStatus = {
          state: 'success',
          message: triggerResult?.payload?.detail || 'Feed refresh queued.',
          at: new Date().toISOString(),
          apiUrl: triggerResult?.apiUrl || null
        };
      } catch (error) {
        state.manualRefreshTriggerStatus = {
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
          apiUrl: null
        };
      }
      rendering.renderAll();
      elements.heroRefresh.textContent = state.manualRefreshTriggerStatus.state === 'error'
        ? 'Refreshing feed...'
        : 'Run queued. Refreshing...';
      await refreshFeedNow();
    } finally {
      elements.heroRefresh.disabled = false;
      elements.heroRefresh.textContent = originalText;
      rendering.renderAll();
    }
  });
}
