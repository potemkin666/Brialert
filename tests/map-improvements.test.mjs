import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  _markerPopup,
  _clusterPopup,
  _SEVERITY_LEGEND_ITEMS,
  _TILE_LIGHT,
  _TILE_DARK,
  _CLUSTER_FLY_DURATION,
  _clusterSeverity,
  _clusterAnchorFor,
  _statusLine,
  _normaliseCountryName,
  _vignetteLevel
} from '../shared/map-watch.mjs';
import { MAP_VIEW_MODES } from '../shared/ui-constants.mjs';

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

describe('CLUSTER_FLY_DURATION', () => {
  it('is a positive number', () => {
    assert.equal(typeof _CLUSTER_FLY_DURATION, 'number');
    assert.ok(_CLUSTER_FLY_DURATION > 0, 'Expected positive duration');
  });

  it('is a reasonable animation duration (under 3 seconds)', () => {
    assert.ok(_CLUSTER_FLY_DURATION <= 3, 'Expected duration <= 3 seconds');
  });
});

describe('clusterSeverity ordering', () => {
  it('returns critical when any item is critical', () => {
    assert.equal(_clusterSeverity([{ severity: 'moderate' }, { severity: 'critical' }]), 'critical');
  });

  it('returns high when items are elevated and high', () => {
    assert.equal(_clusterSeverity([{ severity: 'elevated' }, { severity: 'high' }]), 'high');
  });

  it('returns high when items are high and elevated', () => {
    assert.equal(_clusterSeverity([{ severity: 'high' }, { severity: 'elevated' }]), 'high');
  });

  it('returns elevated when only moderate and elevated are present', () => {
    assert.equal(_clusterSeverity([{ severity: 'moderate' }, { severity: 'elevated' }]), 'elevated');
  });

  it('returns moderate when all items are moderate', () => {
    assert.equal(_clusterSeverity([{ severity: 'moderate' }, { severity: 'moderate' }]), 'moderate');
  });

  it('handles missing severity gracefully', () => {
    assert.equal(_clusterSeverity([{}, { severity: 'high' }]), 'high');
  });

  it('handles single-item clusters', () => {
    assert.equal(_clusterSeverity([{ severity: 'elevated' }]), 'elevated');
  });
});

describe('clusterAnchorFor', () => {
  it('anchors clusters to a real alert coordinate instead of a synthetic midpoint', () => {
    const london = { id: 'london', lat: 51.5074, lng: -0.1278 };
    const paris = { id: 'paris', lat: 48.8566, lng: 2.3522 };
    const madrid = { id: 'madrid', lat: 40.4168, lng: -3.7038 };

    const anchor = _clusterAnchorFor(
      [
        { alert: london, point: { x: 0, y: 0 } },
        { alert: paris, point: { x: 10, y: 0 } },
        { alert: madrid, point: { x: 11, y: 0 } }
      ],
      { x: 7, y: 0 }
    );

    assert.equal(anchor.id, 'paris');
    assert.equal(anchor.lat, paris.lat);
    assert.equal(anchor.lng, paris.lng);
  });

  it('returns null when asked to anchor an empty cluster', () => {
    assert.equal(_clusterAnchorFor([], { x: 0, y: 0 }), null);
  });
});

describe('statusLine text', () => {
  it('says "worldwide" in world mode', () => {
    const text = _statusLine(MAP_VIEW_MODES.world, 5);
    assert.ok(text.includes('worldwide'), `Expected "worldwide" in "${text}"`);
    assert.ok(text.includes('5 alerts'), `Expected "5 alerts" in "${text}"`);
  });

  it('says "in London" in london mode', () => {
    const text = _statusLine(MAP_VIEW_MODES.london, 3);
    assert.ok(text.includes('in London'), `Expected "in London" in "${text}"`);
  });

  it('says "nearby" in nearby mode', () => {
    const text = _statusLine(MAP_VIEW_MODES.nearby, 1);
    assert.ok(text.includes('nearby'), `Expected "nearby" in "${text}"`);
    assert.ok(text.includes('1 alert'), `Expected "1 alert" (singular) in "${text}"`);
  });

  it('says "No alerts" for 0 count', () => {
    const text = _statusLine(MAP_VIEW_MODES.world, 0);
    assert.ok(text.includes('No alerts'), `Expected "No alerts" in "${text}"`);
  });
});

describe('normaliseCountryName', () => {
  it('normalises UK aliases to United Kingdom', () => {
    assert.equal(_normaliseCountryName('uk'), 'United Kingdom');
    assert.equal(_normaliseCountryName('England'), 'United Kingdom');
    assert.equal(_normaliseCountryName('Great Britain'), 'United Kingdom');
  });

  it('normalises US aliases to United States', () => {
    assert.equal(_normaliseCountryName('usa'), 'United States');
    assert.equal(_normaliseCountryName('U.S.'), 'United States');
  });

  it('passes through unknown countries unchanged', () => {
    assert.equal(_normaliseCountryName('France'), 'France');
    assert.equal(_normaliseCountryName('Germany'), 'Germany');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(_normaliseCountryName(''), '');
    assert.equal(_normaliseCountryName(null), '');
    assert.equal(_normaliseCountryName(undefined), '');
  });
});

describe('vignetteLevel', () => {
  it('returns "none" for empty array', () => {
    assert.equal(_vignetteLevel([]), 'none');
  });

  it('returns "none" for null/undefined', () => {
    assert.equal(_vignetteLevel(null), 'none');
    assert.equal(_vignetteLevel(undefined), 'none');
  });

  it('returns "critical" when any item is critical', () => {
    const items = [
      { severity: 'moderate' },
      { severity: 'critical' },
      { severity: 'high' }
    ];
    assert.equal(_vignetteLevel(items), 'critical');
  });

  it('returns "high" as highest when no critical', () => {
    const items = [
      { severity: 'moderate' },
      { severity: 'high' },
      { severity: 'elevated' }
    ];
    assert.equal(_vignetteLevel(items), 'high');
  });

  it('returns "elevated" as highest when no critical/high', () => {
    const items = [{ severity: 'moderate' }, { severity: 'elevated' }];
    assert.equal(_vignetteLevel(items), 'elevated');
  });

  it('returns "moderate" when all items are moderate', () => {
    const items = [{ severity: 'moderate' }, { severity: 'moderate' }];
    assert.equal(_vignetteLevel(items), 'moderate');
  });

  it('returns "moderate" for a single item with no severity', () => {
    assert.equal(_vignetteLevel([{}]), 'moderate');
  });
});
