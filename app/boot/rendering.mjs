import { normaliseRenderState } from '../../shared/feed-controller.mjs';
import { renderMapIfActive } from '../render/map.mjs';
import { renderBriefingMode, renderFeed, renderHero, renderPriority, renderSupporting } from '../render/live.mjs';
import { renderNotes, renderWatchlist } from '../render/notes.mjs';
import { renderSourceRequests } from '../render/source-requests.mjs';

export function createRenderingCoordinator({
  state,
  elements,
  modalController,
  mapController,
  derivedViewStore,
  saveSet,
  watchedStorageKey,
  syncModalWatchToggle
}) {
  const invalidateDerivedView = () => derivedViewStore.invalidate();
  const currentView = () => derivedViewStore.current(state);

  function renderAll() {
    const renderState = normaliseRenderState(state);
    const view = currentView();
    renderHero({ state: renderState, elements });
    renderBriefingMode({ state: renderState, elements, view, modalController });
    renderPriority({ state: renderState, elements, view, modalController });
    renderFeed({
      state: renderState,
      elements,
      view,
      modalController,
      invalidateDerivedView,
      renderAll,
      saveSet,
      watchedStorageKey
    });
    renderSupporting({ elements, view, state: renderState, modalController });
    renderMapIfActive({ state: renderState, view, mapController });
    renderWatchlist({ state: renderState, elements, modalController });
    renderNotes({ state: renderState, elements });
    renderSourceRequests({ state: renderState, elements });
    syncModalWatchToggle();
  }

  return {
    renderAll,
    invalidateDerivedView,
    currentView
  };
}
