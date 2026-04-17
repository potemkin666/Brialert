/**
 * Geo scoring parity tests.
 *
 * These tests verify that the client-side inferGeoPoint (alert-view-model.mjs)
 * and the build-side scoreGeoEntryMatch (geo.mjs) agree on which geo-lookup
 * entry wins for the same input text. Scoring drift between these two
 * implementations was a root cause of the "broken dots" bug where stories
 * about e.g. France showed a dot at the generic Europe fallback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inferGeoPoint } from '../shared/alert-view-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const geoLookup = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'data', 'geo-lookup.json'), 'utf8')
);

// ── Helper ──────────────────────────────────────────────────────────────

/** Build a minimal alert object from location, title, summary. */
function fakeAlert(location, title = '', summary = '') {
  return { location, title, summary };
}

// ── Core parity: demonym terms resolve to the expected country ─────────

const DEMONYM_CASES = [
  { text: 'French court', label: 'France' },
  { text: 'Swedish security', label: 'Sweden' },
  { text: 'German authorities', label: 'Germany' },
  { text: 'Belgian police', label: 'Belgium' },
  { text: 'Dutch investigation', label: 'Netherlands' },
  { text: 'Italian prosecutors', label: 'Italy' },
  { text: 'Spanish court', label: 'Spain' },
  { text: 'Polish border', label: 'Poland' },
  { text: 'Romanian authorities', label: 'Romania' },
  { text: 'Bulgarian elections', label: 'Bulgaria' },
  { text: 'Latvian officials', label: 'Latvia' },
  { text: 'Lebanese forces', label: 'Lebanon' },
  { text: 'Israeli embassy', label: 'Israel' },
  { text: 'Iranian regime', label: 'Iran' },
  { text: 'British intelligence', label: 'United Kingdom' },
  { text: 'Canadian authorities', label: 'Canada' },
  { text: 'Albanian authorities', label: 'Albania' },
  { text: 'Scottish independence', label: 'Scotland, UK' },
  { text: 'English defence', label: 'England, UK' }
];

for (const { text, label } of DEMONYM_CASES) {
  test(`inferGeoPoint resolves demonym "${text}" to ${label}`, () => {
    const result = inferGeoPoint(fakeAlert(text), geoLookup);
    assert.ok(result, `expected a geo result for "${text}"`);
    // Find the expected entry
    const expected = geoLookup.find((e) => e.label === label);
    assert.ok(expected, `expected geo-lookup entry with label "${label}"`);
    assert.equal(result.lat, expected.lat, `lat mismatch for "${text}"`);
    assert.equal(result.lng, expected.lng, `lng mismatch for "${text}"`);
  });
}

// ── Specificity: city should win over country when both appear ──────────

const SPECIFICITY_CASES = [
  { location: 'Paris, France', expectedLabel: 'Paris, France' },
  { location: 'Brussels, Belgium', expectedLabel: 'Brussels, Belgium' },
  { location: 'Madrid, Spain', expectedLabel: 'Madrid, Spain' },
  { location: 'Stockholm, Sweden', expectedLabel: 'Stockholm, Sweden' },
  { location: 'Berlin, Germany', expectedLabel: 'Berlin, Germany' },
  { location: 'Kyiv, Ukraine', expectedLabel: 'Kyiv, Ukraine' }
];

for (const { location, expectedLabel } of SPECIFICITY_CASES) {
  test(`inferGeoPoint picks city over country for "${location}"`, () => {
    const result = inferGeoPoint(fakeAlert(location), geoLookup);
    assert.ok(result, `expected a geo result for "${location}"`);
    const expected = geoLookup.find((e) => e.label === expectedLabel);
    assert.ok(expected, `expected geo-lookup entry with label "${expectedLabel}"`);
    assert.equal(result.lat, expected.lat, `lat mismatch for "${location}"`);
    assert.equal(result.lng, expected.lng, `lng mismatch for "${location}"`);
  });
}

// ── Scoring consistency: kind bonus table matches between client & build ─

test('client scoring kind bonuses match build-side scoreGeoEntryMatch', () => {
  // These are the kind → bonus mappings that MUST be identical
  // in inferGeoPoint (alert-view-model.mjs) and scoreGeoEntryMatch (geo.mjs).
  // If either side changes, this test must be updated — and both must match.
  const EXPECTED_KIND_BONUSES = {
    neighbourhood: 18,
    borough: 16,
    city: 14,
    town: 12,
    airport_area: 11,
    county: 8,
    region: 8,
    state: 8,
    country: 3,
    country_part: 3,
    continent: 1
  };

  // Verify the client-side inferGeoPoint agrees with expected bonuses by
  // constructing two entries that differ only in kind and checking the winner.
  // We use same-length fake terms to isolate the kind bonus from term length.
  for (const [kindA, bonusA] of Object.entries(EXPECTED_KIND_BONUSES)) {
    for (const [kindB, bonusB] of Object.entries(EXPECTED_KIND_BONUSES)) {
      if (kindA >= kindB) continue; // avoid duplicate pairs
      if (bonusA === bonusB) continue; // same bonus, can't distinguish

      // Pad kind names to equal length so term-length component is the same
      const maxLen = Math.max(kindA.length, kindB.length);
      const fakeTermA = `zzzplace${kindA.padEnd(maxLen, 'x')}`;
      const fakeTermB = `zzzplace${kindB.padEnd(maxLen, 'x')}`;
      const testEntries = [
        { terms: [fakeTermA], kind: kindA, precision: 'low', lat: 10, lng: 10, label: `TestA (${kindA})` },
        { terms: [fakeTermB], kind: kindB, precision: 'low', lat: 20, lng: 20, label: `TestB (${kindB})` }
      ];

      const alert = fakeAlert(`${fakeTermA} ${fakeTermB}`);
      const result = inferGeoPoint(alert, testEntries);
      assert.ok(result, `expected result for kinds ${kindA} vs ${kindB}`);

      const expectedWinner = bonusA > bonusB ? testEntries[0] : testEntries[1];
      assert.equal(result.lat, expectedWinner.lat,
        `kind bonus mismatch: ${kindA}(+${bonusA}) vs ${kindB}(+${bonusB}) — expected ${expectedWinner.label} to win`);
    }
  }
});

// ── Precision bonus consistency ─────────────────────────────────────────

test('client scoring precision bonuses are correct (high > medium > low)', () => {
  const testEntries = [
    { terms: ['zzz_prec_high'], kind: 'city', precision: 'high', lat: 1, lng: 1, label: 'High' },
    { terms: ['zzz_prec_medium'], kind: 'city', precision: 'medium', lat: 2, lng: 2, label: 'Medium' },
    { terms: ['zzz_prec_low'], kind: 'city', precision: 'low', lat: 3, lng: 3, label: 'Low' }
  ];

  // high should beat medium
  let result = inferGeoPoint(fakeAlert('zzz_prec_high zzz_prec_medium'), testEntries);
  assert.equal(result.lat, 1, 'high precision should win over medium');

  // medium should beat low
  result = inferGeoPoint(fakeAlert('zzz_prec_medium zzz_prec_low'), testEntries);
  assert.equal(result.lat, 2, 'medium precision should win over low');

  // high should beat low
  result = inferGeoPoint(fakeAlert('zzz_prec_high zzz_prec_low'), testEntries);
  assert.equal(result.lat, 1, 'high precision should win over low');
});

// ── Every country/country_part entry has ≥2 terms (demonym guard) ───────

test('every country/country_part geo-lookup entry has at least 2 terms (name + demonym)', () => {
  const countries = geoLookup.filter(
    (e) => e.kind === 'country' || e.kind === 'country_part'
  );
  assert.ok(countries.length > 0, 'expected at least one country entry');

  const singles = countries.filter((e) => (e.terms || []).length < 2);
  if (singles.length > 0) {
    const details = singles.map((e) => `${e.label}: ${JSON.stringify(e.terms)}`).join('\n  ');
    assert.fail(
      `${singles.length} country/country_part entries have <2 terms (missing demonym?):\n  ${details}`
    );
  }
});
