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
      watchedStorageKey
    });
    renderSupporting({ elements, view, state, modalController });
    renderMapIfActive({ state, view, mapController });
    renderWatchlist({ state, elements, modalController });
    renderNotes({ state, elements });
    renderSourceRequests({ state, elements });
    syncModalWatchToggle();
  }

  return {
    renderAll,
    invalidateDerivedView,
    currentView
  };
}
