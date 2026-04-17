import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceKm, isNearbyAlert, filteredMapView } from '../app/render/map.mjs';
import { MAP_VIEW_MODES, NEARBY_RADIUS_KM } from '../shared/ui-constants.mjs';

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    assert.equal(haversineDistanceKm(51.5, -0.1, 51.5, -0.1), 0);
  });

  it('computes London to Paris roughly as 340 km', () => {
    const d = haversineDistanceKm(51.5074, -0.1278, 48.8566, 2.3522);
    assert.ok(d > 330 && d < 350, `Expected ~340 km, got ${d}`);
  });

  it('computes London to Birmingham roughly as 162 km', () => {
    const d = haversineDistanceKm(51.5074, -0.1278, 52.4862, -1.8904);
    assert.ok(d > 155 && d < 170, `Expected ~162 km, got ${d}`);
  });
});

describe('isNearbyAlert', () => {
  const london = { lat: 51.5074, lng: -0.1278 };

  it('returns false when userLocation is null', () => {
    assert.equal(isNearbyAlert({ lat: 51.5, lng: -0.1 }, null), false);
  });

  it('returns false when userLocation has invalid coords', () => {
    assert.equal(isNearbyAlert({ lat: 51.5, lng: -0.1 }, { lat: NaN, lng: 0 }), false);
  });

  it('returns false when alert has no lat/lng', () => {
    assert.equal(isNearbyAlert({}, london), false);
    assert.equal(isNearbyAlert({ lat: 'abc', lng: -0.1 }, london), false);
  });

  it('returns true for an alert within default radius', () => {
    // Brighton is ~75 km from London
    assert.equal(isNearbyAlert({ lat: 50.8225, lng: -0.1372 }, london), true);
  });

  it('returns false for an alert outside default radius', () => {
    // Paris is ~340 km from London
    assert.equal(isNearbyAlert({ lat: 48.8566, lng: 2.3522 }, london), false);
  });

  it('respects custom radius parameter', () => {
    // Paris at ~340 km; with 400 km radius, should be included
    assert.equal(isNearbyAlert({ lat: 48.8566, lng: 2.3522 }, london, 400), true);
    // With 50 km radius, Brighton (~75 km) should be excluded
    assert.equal(isNearbyAlert({ lat: 50.8225, lng: -0.1372 }, london, 50), false);
  });
});

describe('filteredMapView with nearby mode', () => {
  const london = { lat: 51.5074, lng: -0.1278 };
  const alertNearLondon = { id: '1', lat: 51.45, lng: -0.05, title: 'Near London' };
  const alertFarAway = { id: '2', lat: 40.7128, lng: -74.006, title: 'New York' };
  const alertNoCoords = { id: '3', title: 'No coords' };

  const view = { filtered: [alertNearLondon, alertFarAway, alertNoCoords] };

  it('filters to nearby alerts when in nearby mode with location', () => {
    const state = { mapViewMode: MAP_VIEW_MODES.nearby, userLocation: london };
    const result = filteredMapView(state, view);
    assert.equal(result.filtered.length, 1);
    assert.equal(result.filtered[0].id, '1');
  });

  it('returns all alerts when in nearby mode without location (fallback)', () => {
    const state = { mapViewMode: MAP_VIEW_MODES.nearby, userLocation: null };
    const result = filteredMapView(state, view);
    assert.equal(result.filtered.length, 3, 'Should fall back to all alerts when user location is unavailable');
  });

  it('returns all alerts in world mode', () => {
    const state = { mapViewMode: MAP_VIEW_MODES.world, userLocation: london };
    const result = filteredMapView(state, view);
    assert.equal(result.filtered.length, 3);
  });
});

describe('MAP_VIEW_MODES', () => {
  it('includes nearby mode', () => {
    assert.equal(MAP_VIEW_MODES.nearby, 'nearby');
  });
});

describe('NEARBY_RADIUS_KM', () => {
  it('has a default value of 150', () => {
    assert.equal(NEARBY_RADIUS_KM, 150);
  });

  it('converts to metres for Leaflet L.circle radius', () => {
    const radiusMetres = NEARBY_RADIUS_KM * 1000;
    assert.equal(radiusMetres, 150_000, 'Expected 150 km = 150 000 m');
  });
});
