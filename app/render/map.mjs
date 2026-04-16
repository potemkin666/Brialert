import { isLondonAlert } from '../../shared/alert-view-model.mjs';
import { MAP_VIEW_MODES, NEARBY_RADIUS_KM } from '../../shared/ui-constants.mjs';

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isNearbyAlert(alert, userLocation, radiusKm = NEARBY_RADIUS_KM) {
  if (!userLocation || !Number.isFinite(userLocation.lat) || !Number.isFinite(userLocation.lng)) return false;
  const lat = Number(alert?.lat);
  const lng = Number(alert?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return haversineDistanceKm(userLocation.lat, userLocation.lng, lat, lng) <= radiusKm;
}

export function filteredMapView(state, view) {
  const base = view.filtered;
  if (state.mapViewMode === MAP_VIEW_MODES.london) {
    return { ...view, filtered: base.filter((alert) => isLondonAlert(alert)) };
  }
  if (state.mapViewMode === MAP_VIEW_MODES.nearby) {
    return { ...view, filtered: base.filter((alert) => isNearbyAlert(alert, state.userLocation)) };
  }
  return { ...view, filtered: base };
}

export function renderMapIfActive({ state, view, mapController }) {
  if (state.activeTab === 'map') {
    mapController.renderMap(state, filteredMapView(state, view));
  }
}
