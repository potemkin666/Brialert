import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  _markerPopup,
  _clusterPopup,
  _SEVERITY_LEGEND_ITEMS,
  _TILE_LIGHT,
  _TILE_DARK
} from '../shared/map-watch.mjs';

describe('SEVERITY_LEGEND_ITEMS', () => {
  it('has four severity levels', () => {
    assert.equal(_SEVERITY_LEGEND_ITEMS.length, 4);
  });

  it('includes critical, high, elevated, moderate', () => {
    const levels = _SEVERITY_LEGEND_ITEMS.map((item) => item.level);
    assert.deepEqual(levels, ['critical', 'high', 'elevated', 'moderate']);
  });

  it('each entry has a human-readable label', () => {
    _SEVERITY_LEGEND_ITEMS.forEach((item) => {
      assert.ok(item.label.length > 0, `Expected non-empty label for ${item.level}`);
    });
  });

  it('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(_SEVERITY_LEGEND_ITEMS), 'SEVERITY_LEGEND_ITEMS should be frozen');
  });
});

describe('tile layer URLs', () => {
  it('has a light tile URL pointing to CARTO Positron', () => {
    assert.ok(_TILE_LIGHT.includes('light_all'), 'Expected light_all in TILE_LIGHT URL');
    assert.ok(_TILE_LIGHT.includes('basemaps.cartocdn.com'), 'Expected CARTO domain');
  });

  it('has a dark tile URL pointing to CARTO Dark Matter', () => {
    assert.ok(_TILE_DARK.includes('dark_all'), 'Expected dark_all in TILE_DARK URL');
    assert.ok(_TILE_DARK.includes('basemaps.cartocdn.com'), 'Expected CARTO domain');
  });

  it('light and dark URLs differ only by theme name', () => {
    assert.equal(
      _TILE_LIGHT.replace('light_all', ''),
      _TILE_DARK.replace('dark_all', ''),
      'URLs should match except for the theme segment'
    );
  });
});

describe('markerPopup includes hover-friendly content', () => {
  const alert = {
    id: 'x1',
    title: 'Bridge closure',
    location: 'Tower Bridge, London',
    source: 'TfL',
    time: '09:30'
  };

  it('contains the alert title in the popup for tooltip context', () => {
    const html = _markerPopup(alert);
    assert.ok(html.includes('Bridge closure'), 'Expected title in popup HTML');
  });

  it('contains the open detail button', () => {
    const html = _markerPopup(alert);
    assert.ok(html.includes('data-open-detail="x1"'), 'Expected data-open-detail attribute');
  });
});

describe('clusterPopup hover-friendly content', () => {
  const entry = {
    items: [
      { id: 'c1', title: 'Alert A', location: 'Berlin, Germany' },
      { id: 'c2', title: 'Alert B', location: 'Berlin, Germany' }
    ]
  };

  it('contains the zoom-in button for cluster expansion', () => {
    const html = _clusterPopup(entry);
    assert.ok(html.includes('data-zoom-cluster="true"'), 'Expected zoom cluster button');
  });

  it('shows alert count', () => {
    const html = _clusterPopup(entry);
    assert.ok(html.includes('2 alerts'), 'Expected count in cluster popup');
  });
});
