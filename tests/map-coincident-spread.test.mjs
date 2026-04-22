import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _spreadCoincidentAlerts as spreadCoincidentAlerts } from '../shared/map-watch.mjs';

describe('spreadCoincidentAlerts', () => {
  it('returns input unchanged when alerts have distinct coordinates', () => {
    const alerts = [
      { id: 'a', lat: 51.5, lng: -0.1 },
      { id: 'b', lat: 40.7, lng: -74.0 },
      { id: 'c', lat: 48.8, lng: 2.3 }
    ];
    const result = spreadCoincidentAlerts(alerts);
    assert.equal(result.length, alerts.length);
    result.forEach((alert, i) => {
      assert.equal(alert.lat, alerts[i].lat);
      assert.equal(alert.lng, alerts[i].lng);
    });
  });

  it('spreads coincident alerts so every marker has distinct coordinates', () => {
    const alerts = Array.from({ length: 12 }, (_, i) => ({
      id: `dup-${i}`,
      title: `Alert ${i}`,
      lat: 50,
      lng: 10
    }));
    const result = spreadCoincidentAlerts(alerts);
    const keys = new Set(result.map((a) => `${a.lat.toFixed(6)},${a.lng.toFixed(6)}`));
    assert.equal(keys.size, alerts.length, 'Every spread alert should sit on a unique lat/lng');
  });

  it('keeps spread alerts close to the original location (< ~1.5km)', () => {
    const alerts = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, lat: 50, lng: 10 }));
    const result = spreadCoincidentAlerts(alerts);
    result.forEach((alert) => {
      // Crude degrees->meters using lat degree length; good enough for bound assertion.
      const dLat = (alert.lat - 50) * 111320;
      const dLng = (alert.lng - 10) * 111320 * Math.cos((50 * Math.PI) / 180);
      const distance = Math.hypot(dLat, dLng);
      assert.ok(distance < 1500, `Expected offset under 1500m, got ${distance.toFixed(1)}m`);
    });
  });

  it('is deterministic across repeated calls', () => {
    const alerts = Array.from({ length: 8 }, (_, i) => ({ id: `z${i}`, lat: 54.5, lng: -2.5 }));
    const a = spreadCoincidentAlerts(alerts);
    const b = spreadCoincidentAlerts(alerts);
    a.forEach((alert, i) => {
      assert.equal(alert.lat, b[i].lat);
      assert.equal(alert.lng, b[i].lng);
    });
  });

  it('preserves non-coordinate fields on spread alerts', () => {
    const alerts = [
      { id: '1', title: 'One', severity: 'high', lat: 50, lng: 10 },
      { id: '2', title: 'Two', severity: 'critical', lat: 50, lng: 10 }
    ];
    const result = spreadCoincidentAlerts(alerts);
    assert.equal(result[0].title, 'One');
    assert.equal(result[0].severity, 'high');
    assert.equal(result[1].title, 'Two');
    assert.equal(result[1].severity, 'critical');
  });

  it('leaves alerts with different coordinates alone when mixed with coincident ones', () => {
    const alerts = [
      { id: 'unique', lat: 40.7, lng: -74.0 },
      { id: 'a', lat: 50, lng: 10 },
      { id: 'b', lat: 50, lng: 10 },
      { id: 'c', lat: 50, lng: 10 }
    ];
    const result = spreadCoincidentAlerts(alerts);
    assert.equal(result[0].lat, 40.7);
    assert.equal(result[0].lng, -74.0);
    // The three coincident ones must end up on distinct coordinates.
    const coincidentKeys = new Set(result.slice(1).map((a) => `${a.lat.toFixed(6)},${a.lng.toFixed(6)}`));
    assert.equal(coincidentKeys.size, 3);
  });

  it('handles empty / single-item / invalid-coord inputs safely', () => {
    assert.deepEqual(spreadCoincidentAlerts([]), []);
    assert.deepEqual(spreadCoincidentAlerts([{ id: 'solo', lat: 1, lng: 2 }]), [{ id: 'solo', lat: 1, lng: 2 }]);
    const withNaN = [
      { id: 'a', lat: NaN, lng: 10 },
      { id: 'b', lat: 50, lng: 10 },
      { id: 'c', lat: 50, lng: 10 }
    ];
    const result = spreadCoincidentAlerts(withNaN);
    // The NaN alert is skipped (not grouped); the two valid coincident ones get distinct lat/lng.
    assert.ok(Number.isNaN(result[0].lat));
    assert.notEqual(`${result[1].lat},${result[1].lng}`, `${result[2].lat},${result[2].lng}`);
  });

  it('returns the same array reference contents (does not mutate input alerts)', () => {
    const original = { id: 'a', lat: 50, lng: 10, title: 'keep me' };
    const alerts = [original, { id: 'b', lat: 50, lng: 10 }];
    spreadCoincidentAlerts(alerts);
    assert.equal(original.lat, 50);
    assert.equal(original.lng, 10);
    assert.equal(original.title, 'keep me');
  });
});
