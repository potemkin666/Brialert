import { isLondonAlert } from '../../shared/alert-view-model.mjs';
import { matchesAlertSearch } from '../../shared/feed-controller.mjs';

export function filteredMapView(state, view) {
  const base = state.alerts.filter((alert) =>
    (state.activeLane === 'all' || alert.lane === state.activeLane) &&
    matchesAlertSearch(alert, state.searchQuery)
  );
  const isLondonMode = state.mapViewMode === 'london';
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
