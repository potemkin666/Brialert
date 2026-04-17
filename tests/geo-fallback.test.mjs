import test from 'node:test';
import assert from 'node:assert/strict';

import {
  geoFor,
  inferLocation,
  safeLoadGeoLookup
} from '../scripts/build-live-feed/geo.mjs';

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
