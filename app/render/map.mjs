import { isLondonAlert } from '../../shared/alert-view-model.mjs';
import { MAP_VIEW_MODES } from '../../shared/ui-constants.mjs';

export function filteredMapView(state, view) {
  const base = view.filtered;
  const isLondonMode = state.mapViewMode === MAP_VIEW_MODES.london;
  const filtered = isLondonMode
    ? base.filter((alert) => isLondonAlert(alert))
    : base;

  return {
    ...view,
    filtered
  };
}

export function renderMapIfActive({ state, view, mapController }) {
  if (state.activeTab === 'map') {
    mapController.renderMap(state, filteredMapView(state, view));
  }
}
