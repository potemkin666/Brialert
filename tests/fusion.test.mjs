import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sameStoryKey,
  stableFusionTerms,
  fusedIncidentIdFor,
  sourceReferenceFor,
  mergeCorroboratingSources
} from '../shared/fusion.mjs';

// ── sameStoryKey ──────────────────────────────────────────────────────

test('sameStoryKey normalises title to lowercase without stopwords', () => {
  const key = sameStoryKey({ title: 'The Attack on London Bridge' });
  assert.ok(!key.includes('the'), 'should strip English stopword "the"');
  assert.ok(key.includes('attack'));
  assert.ok(key.includes('london'));
  assert.ok(key.includes('bridge'));
});

test('sameStoryKey strips diacritics', () => {
  const key = sameStoryKey({ title: 'Attaque à la gare de Lyon' });
  assert.ok(!key.includes('à'), 'should strip accent');
  assert.ok(key.includes('attaque'));
});

test('sameStoryKey returns empty string for empty title', () => {
  assert.equal(sameStoryKey({ title: '' }), '');
  assert.equal(sameStoryKey({ title: null }), '');
  assert.equal(sameStoryKey({}), '');
});

test('sameStoryKey collapses whitespace', () => {
  const key = sameStoryKey({ title: 'Multiple   spaces   here' });
  assert.ok(!key.includes('  '), 'should not have double spaces');
});

// ── stableFusionTerms ─────────────────────────────────────────────────

test('stableFusionTerms returns up to 6 tokens', () => {
  const terms = stableFusionTerms({
    title: 'Bomb threat at Heathrow Airport terminal',
    summary: 'A bomb threat was reported at Heathrow Airport. Terminal was evacuated.',
    sourceExtract: 'Heathrow Airport terminal evacuated after bomb threat reported to police.'
  });
  assert.ok(Array.isArray(terms));
  assert.ok(terms.length <= 6);
  assert.ok(terms.length >= 1);
});

test('stableFusionTerms handles empty input', () => {
  const terms = stableFusionTerms({});
  assert.ok(Array.isArray(terms));
});

test('stableFusionTerms deduplicates tokens', () => {
  const terms = stableFusionTerms({
    title: 'Explosion explosion explosion',
    summary: 'An explosion occurred',
    sourceExtract: 'Explosion at the scene'
  });
  const unique = [...new Set(terms)];
  assert.deepEqual(terms, unique);
});

// ── fusedIncidentIdFor ────────────────────────────────────────────────

test('fusedIncidentIdFor returns a fusion- prefixed hash', () => {
  const id = fusedIncidentIdFor({
    title: 'Knife attack in Paris',
    location: 'Paris, France',
    eventType: 'stabbing',
    incidentTrack: 'active',
    summary: 'A stabbing attack occurred near the Eiffel Tower.'
  });
  assert.ok(id.startsWith('fusion-'));
  assert.ok(id.length > 10);
});

test('fusedIncidentIdFor is deterministic', () => {
  const item = {
    title: 'Vehicle attack on Westminster Bridge',
    location: 'London',
    eventType: 'vehicle-ramming',
    incidentTrack: 'closed',
    summary: 'A vehicle drove into pedestrians on Westminster Bridge.'
  };
  const a = fusedIncidentIdFor(item);
  const b = fusedIncidentIdFor(item);
  assert.equal(a, b);
});

test('fusedIncidentIdFor produces different ids for different incidents', () => {
  const idA = fusedIncidentIdFor({
    title: 'Bomb threat in Manchester',
    location: 'Manchester',
    eventType: 'ied-threat',
    incidentTrack: 'active'
  });
  const idB = fusedIncidentIdFor({
    title: 'Knife attack in Berlin',
    location: 'Berlin',
    eventType: 'stabbing',
    incidentTrack: 'active'
  });
  assert.notEqual(idA, idB);
});

// ── sourceReferenceFor ────────────────────────────────────────────────

test('sourceReferenceFor extracts correct fields', () => {
  const alert = {
    fusedIncidentId: 'fusion-abc',
    source: 'BBC News',
    sourceUrl: 'https://bbc.co.uk/news/123',
    sourceTier: 'tier-1',
    reliabilityProfile: 'official_media',
    publishedAt: '2025-01-01T12:00:00Z',
    confidence: 0.9,
    title: 'should not appear'
  };
  const ref = sourceReferenceFor(alert);
  assert.equal(ref.fusedIncidentId, 'fusion-abc');
  assert.equal(ref.source, 'BBC News');
  assert.equal(ref.sourceUrl, 'https://bbc.co.uk/news/123');
  assert.equal(ref.confidence, 0.9);
  assert.equal(ref.title, undefined, 'should not copy extra fields');
});

// ── mergeCorroboratingSources ─────────────────────────────────────────

test('mergeCorroboratingSources merges and deduplicates', () => {
  const primary = {
    corroboratingSources: [
      { source: 'Reuters', sourceUrl: 'https://reuters.com/1', publishedAt: '2025-01-01T10:00:00Z' }
    ]
  };
  const secondary = {
    source: 'AP News',
    sourceUrl: 'https://apnews.com/2',
    sourceTier: 'tier-1',
    reliabilityProfile: 'official_media',
    publishedAt: '2025-01-01T11:00:00Z',
    confidence: 0.8
  };
  const merged = mergeCorroboratingSources(primary, secondary);
  assert.ok(Array.isArray(merged));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, 'AP News', 'Most recent should be first');
});

test('mergeCorroboratingSources removes duplicates', () => {
  const primary = {
    corroboratingSources: [
      { source: 'Reuters', sourceUrl: 'https://reuters.com/1', publishedAt: '2025-01-01T10:00:00Z' }
    ]
  };
  const secondary = {
    source: 'Reuters',
    sourceUrl: 'https://reuters.com/1',
    publishedAt: '2025-01-01T10:00:00Z',
    confidence: 0.8
  };
  const merged = mergeCorroboratingSources(primary, secondary);
  assert.equal(merged.length, 1, 'duplicate should be removed');
});

test('mergeCorroboratingSources handles empty corroboratingSources', () => {
  const primary = {};
  const secondary = {
    source: 'Sky News',
    sourceUrl: 'https://sky.com/1',
    publishedAt: '2025-01-01T12:00:00Z'
  };
  const merged = mergeCorroboratingSources(primary, secondary);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'Sky News');
});

test('mergeCorroboratingSources filters entries with empty source/url', () => {
  const primary = {
    corroboratingSources: [
      { source: '', sourceUrl: '', publishedAt: '2025-01-01T10:00:00Z' }
    ]
  };
  const secondary = {
    source: 'Valid Source',
    sourceUrl: 'https://example.com',
    publishedAt: '2025-01-01T11:00:00Z'
  };
  const merged = mergeCorroboratingSources(primary, secondary);
  assert.equal(merged.length, 1, 'empty source/url entries should be filtered');
  assert.equal(merged[0].source, 'Valid Source');
});
