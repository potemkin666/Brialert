import test from 'node:test';
import assert from 'node:assert/strict';

import {
  geoFor,
  inferLocation,
  safeLoadGeoLookup
} from '../scripts/build-live-feed/geo.mjs';
import { normaliseAlert } from '../shared/alert-view-model.mjs';
import {
  FALLBACK_COORDS,
  FALLBACK_LOCATION_LABELS,
  fallbackCoordsForRegion,
  fallbackLocationLabelForRegion
} from '../shared/geo-fallback-coords.mjs';
import { resolveMapMode } from '../shared/ui-constants.mjs';

// ── Setup: populate the in-memory geo lookup from data/geo-lookup.json ──

await safeLoadGeoLookup(null);

// ── Expected on-land coordinates per region ─────────────────────────────
// These MUST match the geo-lookup.json entries found via fallbackTermForRegion
// and the HARD_FALLBACK_COORDS in geo.mjs.

const EXPECTED = {
  uk:            { lat: 54.5,    lng: -2.5,     label: 'United Kingdom' },
  london:        { lat: 51.5074, lng: -0.1278,  label: 'London, UK' },
  us:            { lat: 39.8283, lng: -98.5795,  label: 'United States' },
  eu:            { lat: 50.0,    lng: 10.0,      label: 'Europe' },
  europe:        { lat: 50.0,    lng: 10.0,      label: 'Europe' },
  international: { lat: 50.0,    lng: 10.0,      label: 'Europe' }
};

const ALL_REGIONS = Object.keys(EXPECTED);

// ── geoFor() fallback tests ─────────────────────────────────────────────

for (const region of ALL_REGIONS) {
  test(`geoFor() with empty text returns on-land coords for region "${region}"`, () => {
    const result = geoFor('', '', '', region);
    assert.equal(result.lat, EXPECTED[region].lat, `lat mismatch for region "${region}"`);
    assert.equal(result.lng, EXPECTED[region].lng, `lng mismatch for region "${region}"`);
  });
}

// ── inferLocation() fallback tests ──────────────────────────────────────

for (const region of ALL_REGIONS) {
  test(`inferLocation() with empty text returns expected label for region "${region}"`, () => {
    const source = { region };
    const result = inferLocation(source, '', '');
    assert.equal(result, EXPECTED[region].label, `label mismatch for region "${region}"`);
  });
}

// ── geoFor() coordinates are valid on-land values ───────────────────────

for (const region of ALL_REGIONS) {
  test(`geoFor() fallback for "${region}" returns finite lat/lng within valid ranges`, () => {
    const { lat, lng } = geoFor('', '', '', region);
    assert.ok(Number.isFinite(lat), 'lat must be finite');
    assert.ok(Number.isFinite(lng), 'lng must be finite');
    assert.ok(lat >= -90 && lat <= 90, `lat ${lat} out of range`);
    assert.ok(lng >= -180 && lng <= 180, `lng ${lng} out of range`);
  });
}

// ── geoFor() with null/undefined inputs still returns valid coords ──────

test('geoFor() with all-null inputs returns valid default coords', () => {
  const result = geoFor(null, null, null, undefined);
  assert.ok(Number.isFinite(result.lat), 'lat must be finite');
  assert.ok(Number.isFinite(result.lng), 'lng must be finite');
  // Should use _default hard fallback (50, 10) since undefined region
  // maps to fallbackTermForRegion default → 'europe' → geo-lookup entry
  assert.equal(result.lat, 50.0);
  assert.equal(result.lng, 10.0);
});

// ── inferLocation() with null/undefined inputs ──────────────────────────

test('inferLocation() with null inputs returns fallback label', () => {
  const result = inferLocation({ region: undefined }, null, null);
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0, 'label must be non-empty');
  assert.equal(result, 'Europe');
});

// ── geoFor() with recognisable location text resolves correctly ─────────

test('geoFor() resolves "manchester" to Manchester coordinates', () => {
  const result = geoFor('manchester', '', '', 'uk');
  assert.equal(result.lat, 53.4808);
  assert.equal(result.lng, -2.2426);
});

test('geoFor() resolves "paris" to Paris coordinates', () => {
  const result = geoFor('paris', '', '', 'europe');
  assert.equal(result.lat, 48.8566);
  assert.equal(result.lng, 2.3522);
});

// ── inferLocation() with recognisable text resolves correctly ────────────

test('inferLocation() resolves "birmingham" in title to Birmingham label', () => {
  const result = inferLocation({ region: 'uk' }, 'Incident in Birmingham', '');
  assert.equal(result, 'Birmingham, UK');
});

// ── Shared FALLBACK_COORDS constant tests ───────────────────────────────

test('FALLBACK_COORDS contains entries for every known region', () => {
  for (const region of ALL_REGIONS) {
    const entry = FALLBACK_COORDS[region];
    assert.ok(entry, `missing FALLBACK_COORDS entry for "${region}"`);
    assert.ok(Number.isFinite(entry.lat), `lat not finite for "${region}"`);
    assert.ok(Number.isFinite(entry.lng), `lng not finite for "${region}"`);
  }
});

test('FALLBACK_LOCATION_LABELS contains entries for every known region', () => {
  for (const region of ALL_REGIONS) {
    const label = FALLBACK_LOCATION_LABELS[region];
    assert.ok(typeof label === 'string' && label.length > 0, `missing label for "${region}"`);
  }
});

test('fallbackCoordsForRegion returns _default for unknown region', () => {
  const result = fallbackCoordsForRegion('unknown-region');
  assert.equal(result.lat, FALLBACK_COORDS._default.lat);
  assert.equal(result.lng, FALLBACK_COORDS._default.lng);
});

test('fallbackLocationLabelForRegion returns _default for unknown region', () => {
  const result = fallbackLocationLabelForRegion('unknown-region');
  assert.equal(result, FALLBACK_LOCATION_LABELS._default);
});

// ── normaliseAlert() client-side fallback coord tests ───────────────────
// These verify the frontend places dots on land (near the fallback center),
// with deterministic jitter so stacked dots spread into a visible cluster.

const JITTER_TOLERANCE = 0.06; // slightly above the ±0.05° jitter range

for (const region of ALL_REGIONS) {
  test(`normaliseAlert() with no coords returns jittered fallback near center for region "${region}"`, () => {
    const alert = normaliseAlert({ id: `test-${region}`, region, title: 'Test' }, 0);
    const expected = EXPECTED[region];
    assert.ok(Math.abs(alert.lat - expected.lat) <= JITTER_TOLERANCE,
      `lat ${alert.lat} too far from fallback ${expected.lat} for region "${region}"`);
    assert.ok(Math.abs(alert.lng - expected.lng) <= JITTER_TOLERANCE,
      `lng ${alert.lng} too far from fallback ${expected.lng} for region "${region}"`);
    assert.equal(alert.geoPrecision, 'fallback', `geoPrecision should be "fallback" for region "${region}"`);
  });
}

for (const region of ALL_REGIONS) {
  test(`normaliseAlert() with no location text returns correct label for region "${region}"`, () => {
    const alert = normaliseAlert({ id: `test-${region}`, region, title: 'Test' }, 0);
    assert.equal(alert.location, EXPECTED[region].label, `location mismatch for region "${region}"`);
  });
}

test('normaliseAlert() preserves explicit coords and does not use fallback', () => {
  const alert = normaliseAlert({ id: 'explicit', region: 'uk', title: 'Test', lat: 51.0, lng: -1.0 }, 0);
  assert.equal(alert.lat, 51.0);
  assert.equal(alert.lng, -1.0);
});

test('normaliseAlert() for unknown region defaults to europe fallback coords with jitter', () => {
  const alert = normaliseAlert({ id: 'unknown-region', region: 'martian', title: 'Test' }, 0);
  assert.equal(alert.region, 'europe');
  assert.ok(Math.abs(alert.lat - EXPECTED.europe.lat) <= JITTER_TOLERANCE,
    `lat ${alert.lat} too far from europe fallback ${EXPECTED.europe.lat}`);
  assert.ok(Math.abs(alert.lng - EXPECTED.europe.lng) <= JITTER_TOLERANCE,
    `lng ${alert.lng} too far from europe fallback ${EXPECTED.europe.lng}`);
  assert.equal(alert.geoPrecision, 'fallback');
});

test('normaliseAlert() jitter is deterministic — same id always produces same coords', () => {
  const a1 = normaliseAlert({ id: 'jitter-stable', region: 'uk', title: 'Test' }, 0);
  const a2 = normaliseAlert({ id: 'jitter-stable', region: 'uk', title: 'Test' }, 0);
  assert.equal(a1.lat, a2.lat);
  assert.equal(a1.lng, a2.lng);
});

test('normaliseAlert() different ids produce different jitter offsets', () => {
  const a1 = normaliseAlert({ id: 'jitter-a', region: 'uk', title: 'Test' }, 0);
  const a2 = normaliseAlert({ id: 'jitter-b', region: 'uk', title: 'Test' }, 1);
  // Not guaranteed to differ but extremely unlikely to be identical
  const bothSame = a1.lat === a2.lat && a1.lng === a2.lng;
  assert.ok(!bothSame, 'different alert ids should produce different jitter offsets');
});

test('normaliseAlert() rejects out-of-range lat/lng and falls back', () => {
  const a = normaliseAlert({ id: 'out-of-range', region: 'uk', title: 'Test', lat: 999, lng: -300 }, 0);
  assert.ok(Math.abs(a.lat - EXPECTED.uk.lat) <= JITTER_TOLERANCE, `lat ${a.lat} should fall back near UK`);
  assert.ok(Math.abs(a.lng - EXPECTED.uk.lng) <= JITTER_TOLERANCE, `lng ${a.lng} should fall back near UK`);
  assert.equal(a.geoPrecision, 'fallback');
});

// ── Coarse-precision jitter tests ──────────────────────────────────────
// Build-side assigns exact fallback coordinates for broad country-level items.
// Those still get deterministic jitter so they do not stack at one pixel.
// Region-level coordinates stay exact so city/metro incidents remain anchored
// to the place named in the story.

const COUNTRY_JITTER_TOLERANCE = 1.6; // slightly above the ±1.5° country jitter range

test('normaliseAlert() applies jitter for geoPrecision "country"', () => {
  const a = normaliseAlert({
    id: 'country-jitter', region: 'uk', title: 'Test',
    lat: 54.5, lng: -2.5, geoPrecision: 'country'
  }, 0);
  assert.notEqual(a.lat, 54.5, 'lat should be jittered away from exact fallback');
  assert.notEqual(a.lng, -2.5, 'lng should be jittered away from exact fallback');
  assert.ok(Math.abs(a.lat - 54.5) <= COUNTRY_JITTER_TOLERANCE,
    `jittered lat ${a.lat} should stay within ±1.5° of 54.5`);
  assert.ok(Math.abs(a.lng - (-2.5)) <= COUNTRY_JITTER_TOLERANCE,
    `jittered lng ${a.lng} should stay within ±1.5° of -2.5`);
  assert.equal(a.geoPrecision, 'country');
});

test('normaliseAlert() preserves exact coords for geoPrecision "region"', () => {
  const a = normaliseAlert({
    id: 'region-jitter', region: 'london', title: 'Test',
    lat: 51.5074, lng: -0.1278, geoPrecision: 'region'
  }, 0);
  assert.equal(a.lat, 51.5074, 'region-precision lat should stay exact');
  assert.equal(a.lng, -0.1278, 'region-precision lng should stay exact');
  assert.equal(a.geoPrecision, 'region');
});

test('normaliseAlert() country jitter is wider than exact region placement', () => {
  // Compute average absolute jitter for 20 country-level and 20 region-level ids
  let countrySum = 0;
  let regionSum = 0;
  for (let i = 0; i < 20; i++) {
    const c = normaliseAlert({
      id: `spread-country-${i}`, region: 'uk', title: 'T',
      lat: 54.5, lng: -2.5, geoPrecision: 'country'
    }, i);
    countrySum += Math.abs(c.lat - 54.5) + Math.abs(c.lng - (-2.5));
    const r = normaliseAlert({
      id: `spread-region-${i}`, region: 'uk', title: 'T',
      lat: 54.5, lng: -2.5, geoPrecision: 'region'
    }, i);
    regionSum += Math.abs(r.lat - 54.5) + Math.abs(r.lng - (-2.5));
  }
  assert.equal(regionSum, 0, 'region precision should no longer be jittered');
  assert.ok(countrySum > regionSum,
    `country jitter total ${countrySum.toFixed(3)} should exceed region total ${regionSum.toFixed(3)}`);
});

test('normaliseAlert() does NOT jitter for geoPrecision "city"', () => {
  const a = normaliseAlert({
    id: 'city-exact', region: 'uk', title: 'Test',
    lat: 53.4808, lng: -2.2426, geoPrecision: 'city'
  }, 0);
  assert.equal(a.lat, 53.4808, 'city-precision lat should be preserved exactly');
  assert.equal(a.lng, -2.2426, 'city-precision lng should be preserved exactly');
});

test('normaliseAlert() coarse-precision jitter is deterministic', () => {
  const a1 = normaliseAlert({
    id: 'stable-country', region: 'eu', title: 'Test',
    lat: 50, lng: 10, geoPrecision: 'country'
  }, 0);
  const a2 = normaliseAlert({
    id: 'stable-country', region: 'eu', title: 'Test',
    lat: 50, lng: 10, geoPrecision: 'country'
  }, 0);
  assert.equal(a1.lat, a2.lat, 'same id should produce same jittered lat');
  assert.equal(a1.lng, a2.lng, 'same id should produce same jittered lng');
});

test('normaliseAlert() different ids at same coarse coords produce different jitter', () => {
  const a1 = normaliseAlert({
    id: 'coarse-a', region: 'uk', title: 'Test',
    lat: 54.5, lng: -2.5, geoPrecision: 'country'
  }, 0);
  const a2 = normaliseAlert({
    id: 'coarse-b', region: 'uk', title: 'Test',
    lat: 54.5, lng: -2.5, geoPrecision: 'country'
  }, 1);
  const bothSame = a1.lat === a2.lat && a1.lng === a2.lng;
  assert.ok(!bothSame, 'different alert ids should produce different jitter at coarse precision');
});

// ── resolveMapMode default tests ───────────────────────────────────────

test('resolveMapMode returns world as default for invalid input', () => {
  assert.equal(resolveMapMode('garbage'), 'world');
  assert.equal(resolveMapMode(undefined), 'world');
  assert.equal(resolveMapMode(''), 'world');
});

test('resolveMapMode preserves valid modes', () => {
  assert.equal(resolveMapMode('london'), 'london');
  assert.equal(resolveMapMode('world'), 'world');
  assert.equal(resolveMapMode('nearby'), 'nearby');
});
