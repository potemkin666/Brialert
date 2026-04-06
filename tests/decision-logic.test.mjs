import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { coerceLiveFeedPayload, deriveFeedHealthStatus, deriveView, loadLiveFeed } from '../shared/feed-controller.mjs';
import {
  discardReasonForItem,
  recencyOkay,
  shouldKeepItem,
  retentionScoreFor,
  selectStoredAlerts
} from '../scripts/build-live-feed/alerts.mjs';
import {
  confidenceScoreLabel,
  isLiveIncidentCandidate,
  isQuarantineCandidate,
  normaliseAlert,
  trustSignal
} from '../shared/alert-view-model.mjs';
import {
  inferIncidentTrack,
  isTerrorRelevantIncident,
  matchesKeywords,
  terrorismKeywords
} from '../shared/taxonomy.mjs';
import {
  fusedIncidentIdFor,
  mergeCorroboratingSources
} from '../shared/fusion.mjs';
import { buildHealthBlock } from '../scripts/build-live-feed.mjs';
import { normaliseSourcesPayload } from '../scripts/build-live-feed/io.mjs';
import {
  CONTROL_MAX_HTML_SOURCES_PER_RUN,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  FEED_SOURCE_CONCURRENCY,
  MAX_FEED_PREFETCH_ITEMS,
  MAX_HTML_PREFETCH_ITEMS,
  MAX_HTML_SOURCES_PER_RUN,
  shouldRefreshSourceThisRun,
  sourceRefreshEveryHours,
  sourceRefreshOffset
} from '../scripts/build-live-feed/config.mjs';
import { renderHero, renderSupporting } from '../app/render/live.mjs';
import { filteredMapView } from '../app/render/map.mjs';
import { addSourceRequest } from '../app/render/notes.mjs';
import {
  INITIAL_RESPONDER_VISIBLE,
  INITIAL_SUPPORTING_VISIBLE,
  createState
} from '../app/state/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - (minutes * 60 * 1000)).toISOString();
}

function makeAlert(overrides = {}) {
  return normaliseAlert({
    id: 'alert-1',
    title: 'Counter-terror police disrupt bomb plot in Paris',
    location: 'Paris',
    region: 'europe',
    lane: 'incidents',
    severity: 'critical',
    status: 'Threat update',
    source: 'Counter Terrorism Policing',
    sourceUrl: 'https://example.test/alert-1',
    sourceTier: 'trigger',
    reliabilityProfile: 'official_ct',
    incidentTrack: 'live',
    isOfficial: true,
    confidence: 'Verified CT source update',
    confidenceScore: 0.96,
    summary: 'Police disrupted a terrorism plot after locating an explosive device in Paris.',
    aiSummary: 'Police disrupted a terrorism plot after locating an explosive device in Paris.',
    sourceExtract: 'Police disrupted a terrorism plot after locating an explosive device in Paris.',
    terrorismHits: ['terrorism', 'plot', 'explosive'],
    isTerrorRelevant: true,
    queueReason: 'Trigger-tier terrorism incident candidate',
    laneReason: 'Terror-related live incident or disrupted plot candidate from an incident feed.',
    eventType: 'disrupted_plot',
    publishedAt: isoMinutesAgo(30),
    happenedWhen: '31 Mar 2026, 11:30',
    time: '31 Mar 2026, 11:30',
    freshUntil: isoMinutesAgo(-60),
    corroboratingSources: [],
    corroborationCount: 0,
    ...overrides
  }, 0, []);
}

test('terror relevance gating rejects generic crime coverage from broad media', () => {
  const metadata = {
    lane: 'incidents',
    provider: 'Reuters',
    source: 'Reuters',
    sourceTier: 'corroboration',
    reliabilityProfile: 'major_media',
    isOfficial: false,
    title: 'Police arrest teenager in extortion case'
  };
  const item = {
    title: 'Police arrest teenager in extortion case',
    summary: 'Police said a teenager was arrested after threatening schoolchildren for money.',
    sourceExtract: 'No terrorism links were reported.'
  };

  assert.equal(isTerrorRelevantIncident(metadata, item), false);
});

test('incident track split keeps live scenes separate from case/prosecution stories', () => {
  assert.equal(
    inferIncidentTrack({
      lane: 'incidents',
      eventType: 'active_attack',
      text: 'Police evacuated the station after finding an explosive device and an ongoing cordon remains.'
    }),
    'live'
  );

  assert.equal(
    inferIncidentTrack({
      lane: 'incidents',
      eventType: 'charge',
      text: 'A suspect was charged after a terrorism investigation.'
    }),
    'case'
  );
});

test('quarantine routing catches weak secondary incident-like items', () => {
  const weakSecondary = makeAlert({
    id: 'alert-2',
    title: 'Broad outlet reports threat near embassy',
    source: 'Reuters',
    sourceTier: 'corroboration',
    reliabilityProfile: 'major_media',
    isOfficial: false,
    confidenceScore: 0.72,
    needsHumanReview: true,
    queueReason: 'Needs human review',
    queueBucket: 'quarantine'
  });

  const liveOfficial = makeAlert({
    queueBucket: 'responder'
  });
  const state = {
    alerts: [liveOfficial, weakSecondary],
    activeRegion: 'all',
    activeLane: 'all'
  };

  const view = deriveView(state, {
    sortAlertsByFreshness: (alerts) => alerts
  });

  assert.equal(view.responder.length, 1);
  assert.equal(view.quarantine.length, 1);
  assert.equal(view.quarantine[0].id, 'alert-2');
});

test('fusion id stays stable across near-duplicate source variants', () => {
  const a = fusedIncidentIdFor({
    title: 'Police disrupt terror plot in Paris after explosive device found',
    summary: 'An explosive device was found in Paris and officers disrupted the plot.',
    sourceExtract: 'Explosive device found in Paris as police disrupted the terror plot.',
    location: 'Paris',
    eventType: 'disrupted_plot',
    incidentTrack: 'live'
  });

  const b = fusedIncidentIdFor({
    title: 'Explosive device found in Paris as terror plot disrupted',
    summary: 'Officers say the Paris plot was disrupted after locating an explosive device.',
    sourceExtract: 'Police disrupted the Paris terror plot after locating the device.',
    location: 'Paris',
    eventType: 'disrupted_plot',
    incidentTrack: 'live'
  });

  const c = fusedIncidentIdFor({
    title: 'Bomb plot disrupted in Brussels',
    summary: 'Police disrupted a bomb plot in Brussels.',
    sourceExtract: 'Police disrupted a bomb plot in Brussels.',
    location: 'Brussels',
    eventType: 'disrupted_plot',
    incidentTrack: 'live'
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('corroboration merge dedupes repeated sources and keeps newest first', () => {
  const primary = makeAlert({
    corroboratingSources: [
      {
        fusedIncidentId: 'fusion-1',
        source: 'Reuters',
        sourceUrl: 'https://example.test/reuters',
        sourceTier: 'corroboration',
        reliabilityProfile: 'major_media',
        publishedAt: isoMinutesAgo(25),
        confidence: 'Major media source signal'
      }
    ]
  });

  const secondary = makeAlert({
    source: 'BBC News',
    sourceUrl: 'https://example.test/bbc',
    sourceTier: 'corroboration',
    reliabilityProfile: 'major_media',
    publishedAt: isoMinutesAgo(10),
    confidence: 'Major media source signal',
    fusedIncidentId: 'fusion-1'
  });

  const merged = mergeCorroboratingSources(primary, secondary);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, 'BBC News');
  assert.equal(merged[1].source, 'Reuters');

  const deduped = mergeCorroboratingSources(
    { ...primary, corroboratingSources: merged },
    { ...secondary, publishedAt: isoMinutesAgo(5) }
  );
  assert.equal(deduped.length, 2);
});

test('trust signal reports confirmed for official-backed items', () => {
  const alert = makeAlert({
    reliabilityProfile: 'official_ct',
    isOfficial: true,
    confidenceScore: 0.96,
    publishedAt: isoMinutesAgo(20),
    corroboratingSources: [],
    corroborationCount: 0
  });

  assert.equal(trustSignal(alert).label, 'CONFIRMED');
});

test('trust signal reports multi-source for non-official corroborated items', () => {
  const alert = makeAlert({
    reliabilityProfile: 'major_media',
    isOfficial: false,
    confidenceScore: 0.84,
    publishedAt: isoMinutesAgo(20),
    corroboratingSources: [
      {
        source: 'Sky News',
        sourceUrl: 'https://example.test/sky',
        sourceTier: 'corroboration',
        reliabilityProfile: 'major_media',
        publishedAt: isoMinutesAgo(10)
      }
    ],
    corroborationCount: 1
  });

  assert.equal(trustSignal(alert).label, 'MULTI-SOURCE');
});

test('trust signal reports unverified when confidence score is missing', () => {
  const alert = makeAlert({
    confidenceScore: null
  });

  assert.equal(trustSignal(alert).label, 'UNVERIFIED');
  assert.equal(confidenceScoreLabel(alert), 'CONFIDENCE: UNAVAILABLE');
});

test('health block preserves last successful refresh when fallback output is reused', () => {
  const prior = {
    lastSuccessfulRefreshTime: '2026-04-03T12:00:00.000Z',
    lastSuccessfulRunId: '111',
    lastSuccessfulRunNumber: '22',
    lastSuccessfulRunAttempt: '1',
    lastSuccessfulHeadSha: 'abc123',
    lastSuccessfulEvent: 'schedule',
    lastSuccessfulSourceCount: 88
  };

  const health = buildHealthBlock({
    generatedAt: '2026-04-03T12:15:00.000Z',
    checked: 0,
    sourceErrors: [{ message: 'sources failed' }],
    buildWarning: 'Preserved previous alerts',
    previousHealth: prior,
    successfulRefresh: false,
    usedFallback: true
  });

  assert.equal(health.lastAttemptedRefreshTime, '2026-04-03T12:15:00.000Z');
  assert.equal(health.lastSuccessfulRefreshTime, '2026-04-03T12:00:00.000Z');
  assert.equal(health.lastSuccessfulRunId, '111');
  assert.equal(health.lastSuccessfulSourceCount, 88);
  assert.equal(health.usedFallback, true);
});

test('health block records a fresh success when the builder completes normally', () => {
  const health = buildHealthBlock({
    generatedAt: '2026-04-03T12:15:00.000Z',
    checked: 42,
    sourceErrors: [],
    buildWarning: null,
    successfulRefresh: true,
    usedFallback: false
  });

  assert.equal(health.lastAttemptedRefreshTime, '2026-04-03T12:15:00.000Z');
  assert.equal(health.lastSuccessfulRefreshTime, '2026-04-03T12:15:00.000Z');
  assert.equal(health.lastSuccessfulSourceCount, 42);
  assert.equal(health.usedFallback, false);
});

test('health block carries source cooldown metadata for low-yield sources', () => {
  const health = buildHealthBlock({
    generatedAt: '2026-04-05T09:00:00.000Z',
    checked: 18,
    sourceErrors: [],
    buildWarning: 'Deferred 1 low-yield source(s) on health cooldown. | Deferred 2 source(s) due to run budget or disabled Playwright fallback.',
    successfulRefresh: true,
    usedFallback: false,
    autoDeferredSources: [
      {
        id: 'weak-context-source',
        reason: 'empty-cooldown',
        until: '2026-04-06T09:00:00.000Z'
      }
    ],
    operationalDeferredSources: [
      {
        id: 'budgeted-html-source',
        reason: 'html-budget',
        until: null
      },
      {
        id: 'playwright-source',
        reason: 'playwright-disabled',
        until: null
      }
    ],
    sourceHealth: {
      'weak-context-source': {
        consecutiveEmptyRuns: 6,
        autoSkipReason: 'empty-cooldown',
        cooldownUntil: '2026-04-06T09:00:00.000Z'
      }
    }
  });

  assert.equal(health.autoDeferredSourceCount, 1);
  assert.equal(health.autoDeferredSources[0].id, 'weak-context-source');
  assert.equal(health.operationalDeferredSourceCount, 2);
  assert.equal(health.operationalDeferredSources[0].id, 'budgeted-html-source');
  assert.equal(health.sourceHealth['weak-context-source'].autoSkipReason, 'empty-cooldown');
});

test('health block stores extra scheduler metrics when provided', () => {
  const health = buildHealthBlock({
    generatedAt: '2026-04-05T09:00:00.000Z',
    checked: 12,
    sourceErrors: [],
    buildWarning: null,
    successfulRefresh: true,
    usedFallback: false,
    extraMetrics: {
      schedulerMode: 'candidate',
      coverage: { eligible: 100, checked: 12 }
    },
    sourceRunStats: {
      totalConfiguredSources: 250,
      sourcesCheckedThisRun: 52,
      sourcesUpdatedThisRun: 19,
      sourcesFailedThisRun: 5,
      sourcesUnchangedThisRun: 7
    }
  });

  assert.equal(health.extraMetrics.schedulerMode, 'candidate');
  assert.equal(health.extraMetrics.coverage.checked, 12);
  assert.equal(health.sourceRunStats.totalConfiguredSources, 250);
  assert.equal(health.sourceRunStats.sourcesCheckedThisRun, 52);
  assert.equal(health.sourceRunStats.sourcesUpdatedThisRun, 19);
  assert.equal(health.sourceRunStats.sourcesFailedThisRun, 5);
  assert.equal(health.sourceRunStats.sourcesUnchangedThisRun, 7);
});

test('feed health status flags stale fallback data honestly', () => {
  const snapshot = deriveFeedHealthStatus({
    health: {
      staleAfterMinutes: 22,
      lastSuccessfulRefreshTime: '2026-04-03T10:00:00.000Z',
      lastSuccessfulRunId: '555',
      lastSuccessfulSourceCount: 120,
      hasWarnings: true,
      usedFallback: true
    },
    generatedAt: new Date('2026-04-03T10:15:00.000Z'),
    sourceCount: 120,
    fetchError: null,
    now: new Date('2026-04-03T10:30:01.000Z').getTime()
  });

  assert.equal(snapshot.visible, true);
  assert.equal(snapshot.isStale, true);
  assert.equal(snapshot.usedFallback, true);
  assert.equal(snapshot.runId, '555');
  assert.equal(snapshot.sourceCount, 120);
});

test('feed health status surfaces fetch failure even when last good data exists', () => {
  const snapshot = deriveFeedHealthStatus({
    health: {
      staleAfterMinutes: 22,
      lastSuccessfulRefreshTime: '2026-04-03T12:00:00.000Z',
      lastSuccessfulRunId: '777',
      lastSuccessfulSourceCount: 95
    },
    generatedAt: new Date('2026-04-03T12:00:00.000Z'),
    sourceCount: 95,
    fetchError: { message: 'HTTP 503', at: '2026-04-03T12:05:00.000Z' },
    now: new Date('2026-04-03T12:05:10.000Z').getTime()
  });

  assert.equal(snapshot.visible, true);
  assert.equal(snapshot.isFetchError, true);
  assert.equal(snapshot.isStale, false);
});

test('live feed coercion keeps all payload alerts for frontend rendering path', () => {
  const payload = coerceLiveFeedPayload({
    generatedAt: '2026-04-04T10:00:00.000Z',
    sourceCount: 2,
    alerts: [
      {
        id: 'good-1',
        title: 'Counter-terror police disrupt bomb plot in Paris',
        summary: 'Police disrupted a terrorism plot after locating an explosive device in Paris.',
        source: 'Counter Terrorism Policing',
        sourceUrl: 'https://example.test/good-1',
        location: 'Paris',
        region: 'europe',
        lane: 'incidents',
        sourceTier: 'trigger',
        reliabilityProfile: 'official_ct',
        incidentTrack: 'live',
        isTerrorRelevant: true,
        keywordHits: ['plot'],
        terrorismHits: ['terrorism'],
        queueReason: 'Trigger-tier terrorism incident candidate',
        laneReason: 'Terror-related live incident or disrupted plot candidate from an incident feed.'
      },
      {
        id: 'bad-1',
        title: 'Broken alert missing core fields',
        source: 'Broken Source',
        location: 'Unknown',
        region: 'europe',
        lane: 'incidents'
      }
    ]
  });

  assert.equal(payload.alerts.length, 2);
  assert.equal(payload.alerts[0].id, 'good-1');
  assert.equal(payload.fetchedAlertCount, 2);
});

test('live feed coercion accepts malformed alerts without dropping payload entries', () => {
  const payload = coerceLiveFeedPayload({
    generatedAt: '2026-04-04T10:00:00.000Z',
    sourceCount: 1,
    alerts: [
      {
        id: 'bad-1',
        title: 'Broken alert missing core fields',
        source: 'Broken Source',
        location: 'Unknown',
        region: 'europe',
        lane: 'incidents'
      }
    ]
  });

  assert.equal(payload.alerts.length, 1);
  assert.equal(payload.fetchedAlertCount, 1);
});

test('live feed coercion rejects alertCount lower than alerts length', () => {
  assert.throws(() => {
    coerceLiveFeedPayload({
      generatedAt: '2026-04-04T10:00:00.000Z',
      sourceCount: 1,
      alertCount: 0,
      alerts: [
        {
          id: 'a-1',
          title: 'Alert title',
          source: 'Alert source',
          sourceUrl: 'https://example.test/a-1',
          location: 'London',
          summary: 'Alert summary',
          region: 'london',
          lane: 'context'
        }
      ]
    });
  }, /alertCount cannot be lower than alerts array length/);
});

test('loadLiveFeed accepts empty renderable payload and clears alerts into standby', async () => {
  const state = {
    alerts: [makeAlert({ id: 'existing-1' })],
    geoLookup: [],
    liveFeedGeneratedAt: null,
    liveSourceCount: 0,
    liveFetchedAlertCount: 0,
    liveFeedHealth: null,
    liveFeedFetchError: null,
    lastBrowserPollAt: null
  };

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        generatedAt: '2026-04-04T10:00:00.000Z',
        sourceCount: 1,
        alerts: [
          {
            id: 'bad-1',
            title: 'Broken alert missing core fields',
            source: 'Broken Source',
            location: 'Unknown',
            region: 'europe',
            lane: 'incidents'
          }
        ]
      };
    }
  });

  try {
    await loadLiveFeed(state, {
      liveFeedUrl: 'live-alerts.json',
      normaliseAlert,
      onAfterLoad: () => {}
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(state.alerts.length, 1);
  assert.equal(state.liveFeedFetchError, null);
  assert.equal(state.liveSourceCount, 1);
  assert.equal(state.liveFetchedAlertCount, 1);
});

test('loadLiveFeed falls back to health lastSuccessfulSourceCount when payload sourceCount is zero', async () => {
  const state = {
    alerts: [],
    geoLookup: [],
    liveFeedGeneratedAt: null,
    liveSourceCount: 0,
    liveFetchedAlertCount: 0,
    liveFeedHealth: null,
    liveFeedFetchError: null,
    lastBrowserPollAt: null
  };

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        generatedAt: '2026-04-04T10:00:00.000Z',
        sourceCount: 0,
        alerts: [],
        health: {
          lastSuccessfulSourceCount: 118
        }
      };
    }
  });

  try {
    await loadLiveFeed(state, {
      liveFeedUrl: 'live-alerts.json',
      normaliseAlert,
      onAfterLoad: () => {}
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(state.liveSourceCount, 118);
  assert.equal(state.liveFeedFetchError, null);
  assert.equal(state.liveFetchedAlertCount, 0);
});

test('loadLiveFeed stores source run stats from health payload for frontend status rendering', async () => {
  const state = {
    alerts: [],
    geoLookup: [],
    liveFeedGeneratedAt: null,
    liveSourceCount: 0,
    liveSourceRunStats: null,
    liveFetchedAlertCount: 0,
    liveFeedHealth: null,
    liveFeedFetchError: null,
    lastBrowserPollAt: null
  };

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        generatedAt: '2026-04-04T10:00:00.000Z',
        sourceCount: 12,
        alerts: [],
        health: {
          lastSuccessfulRefreshTime: '2026-04-04T09:57:00.000Z',
          sourceRunStats: {
            totalConfiguredSources: 240,
            sourcesCheckedThisRun: 52,
            sourcesUpdatedThisRun: 11,
            sourcesFailedThisRun: 4,
            sourcesUnchangedThisRun: 8
          }
        }
      };
    }
  });

  try {
    await loadLiveFeed(state, {
      liveFeedUrl: 'live-alerts.json',
      normaliseAlert,
      onAfterLoad: () => {}
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(state.liveSourceRunStats.totalConfiguredSources, 240);
  assert.equal(state.liveSourceRunStats.sourcesCheckedThisRun, 52);
  assert.equal(state.liveSourceRunStats.sourcesUpdatedThisRun, 11);
  assert.equal(state.liveSourceRunStats.sourcesFailedThisRun, 4);
  assert.equal(state.liveSourceRunStats.sourcesUnchangedThisRun, 8);
  assert.equal(state.liveSourceRunStats.lastSuccessfulGlobalBuild, '2026-04-04T09:57:00.000Z');
});

test('matchesKeywords uses word-boundary matching and does not match substrings', () => {
  // 'threat' must not match 'threatening'
  assert.deepEqual(matchesKeywords('he was threatening schoolchildren', terrorismKeywords), []);
  // 'terrorism' must match standalone 'terrorism'
  const terrorismHits = matchesKeywords('a terrorism plot was disrupted', terrorismKeywords);
  assert.ok(terrorismHits.includes('terrorism'), 'terrorism should match standalone word');
  // 'terror' must not match inside 'counterterrorism' (no space boundary)
  const ctHits = matchesKeywords('counterterrorism agency published guidance', terrorismKeywords);
  assert.ok(!ctHits.includes('terror'), 'terror should not match as substring of counterterrorism');
  // Multi-word keywords: 'al-qaeda' should match standalone
  const aqHits = matchesKeywords('al-qaeda operative charged', terrorismKeywords);
  assert.ok(aqHits.includes('al-qaeda'), 'al-qaeda should match as standalone term');
});

test('isTerrorRelevantIncident strips negated terrorism context before scoring', () => {
  const metadata = {
    lane: 'incidents',
    provider: 'BBC News',
    source: 'BBC News',
    sourceTier: 'corroboration',
    reliabilityProfile: 'major_media',
    isOfficial: false
  };

  // Denial phrase: "no terrorism links" must NOT cause a terror hit
  const denialItem = {
    title: 'Stabbing in city centre',
    summary: 'A man was arrested after a stabbing near a market.',
    sourceExtract: 'Police said there are no terrorism links to the incident.'
  };
  assert.equal(isTerrorRelevantIncident(metadata, denialItem), false,
    'denial context "no terrorism links" should not produce a positive terror hit');

  // Real terrorism content MUST still pass
  const realItem = {
    title: 'Counter-terror police arrest suspect over bomb plot',
    summary: 'A terrorism suspect was arrested in connection with a foiled bomb plot.',
    sourceExtract: 'The suspect had been radicalised online and was planning a terrorist attack.'
  };
  assert.equal(isTerrorRelevantIncident(metadata, realItem), true,
    'genuine terrorism content should still return true');
});

test('sources catalog passes structural and per-field validation', () => {
  const sourcesPath = path.join(__dirname, '..', 'data', 'sources.json');
  const raw = fs.readFileSync(sourcesPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  const sources = Array.isArray(parsed.sources) ? parsed.sources : parsed;

  assert.ok(Array.isArray(sources), 'sources should be an array');
  assert.ok(sources.length > 0, 'sources array should not be empty');

  const VALID_KINDS = new Set(['rss', 'atom', 'json', 'html', 'playwright_html']);
  const VALID_LANES = new Set(['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention']);
  const VALID_REGIONS = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);
  const ids = new Set();
  const errors = [];

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (!s || typeof s !== 'object') { errors.push(`[${i}] not an object`); continue; }
    if (typeof s.id !== 'string' || !s.id.trim()) errors.push(`[${i}] missing id`);
    if (typeof s.provider !== 'string' || !s.provider.trim()) errors.push(`[${i}] (${s.id}) missing provider`);
    if (typeof s.endpoint !== 'string' || !s.endpoint.startsWith('http')) errors.push(`[${i}] (${s.id}) bad endpoint`);
    if (!VALID_KINDS.has(s.kind)) errors.push(`[${i}] (${s.id}) invalid kind: ${s.kind}`);
    if (!VALID_LANES.has(s.lane)) errors.push(`[${i}] (${s.id}) invalid lane: ${s.lane}`);
    if (!VALID_REGIONS.has(s.region)) errors.push(`[${i}] (${s.id}) invalid region: ${s.region}`);
    if (typeof s.isTrustedOfficial !== 'boolean') errors.push(`[${i}] (${s.id}) isTrustedOfficial must be boolean`);
    if (typeof s.requiresKeywordMatch !== 'boolean') errors.push(`[${i}] (${s.id}) requiresKeywordMatch must be boolean`);
    if (s.id && ids.has(s.id)) errors.push(`duplicate id: ${s.id}`);
    if (s.id) ids.add(s.id);
    // Warn if provider contains mojibake characters
    if (s.provider && /â€/.test(s.provider)) errors.push(`[${i}] (${s.id}) provider contains mojibake: ${s.provider}`);
  }

  assert.equal(errors.length, 0,
    `Sources catalog has ${errors.length} error(s):\n  ${errors.join('\n  ')}`);
});

test('stored alert selection keeps live incidents and fresh official corroboration over stale weak context', () => {
  const liveIncident = makeAlert({
    id: 'live-1',
    lane: 'incidents',
    sourceTier: 'trigger',
    reliabilityProfile: 'official_ct',
    incidentTrack: 'live',
    isOfficial: true,
    publishedAt: isoMinutesAgo(45),
    priorityScore: 16
  });

  const freshOfficialContext = makeAlert({
    id: 'context-1',
    lane: 'context',
    sourceTier: 'corroboration',
    reliabilityProfile: 'official_context',
    incidentTrack: '',
    isOfficial: true,
    publishedAt: isoMinutesAgo(180),
    priorityScore: 8
  });

  const staleWeakContext = makeAlert({
    id: 'context-2',
    lane: 'context',
    sourceTier: 'context',
    reliabilityProfile: 'general_media',
    incidentTrack: '',
    isOfficial: false,
    publishedAt: new Date(Date.now() - (10 * 24 * 60 * 60 * 1000)).toISOString(),
    priorityScore: 7
  });

  const selected = selectStoredAlerts(
    [liveIncident, freshOfficialContext, staleWeakContext],
    2
  );

  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((alert) => alert.id), ['live-1', 'context-1']);
  assert.ok(retentionScoreFor(liveIncident) > retentionScoreFor(staleWeakContext));
  assert.ok(retentionScoreFor(freshOfficialContext) > retentionScoreFor(staleWeakContext));
});

test('shouldKeepItem rejects items without a reliable publish date', () => {
  const source = {
    lane: 'context',
    provider: 'Official context source',
    isTrustedOfficial: true,
    requiresKeywordMatch: false
  };

  const missingDateItem = {
    title: 'Context update on terrorism legislation',
    summary: 'Official review update mentions terrorism safeguards.',
    sourceExtract: 'Terrorism safeguards and legal review details.',
    published: null
  };

  const invalidDateItem = {
    title: 'Context update on terrorism legislation',
    summary: 'Official review update mentions terrorism safeguards.',
    sourceExtract: 'Terrorism safeguards and legal review details.',
    published: 'not-a-date'
  };

  assert.equal(shouldKeepItem(source, missingDateItem), false);
  assert.equal(shouldKeepItem(source, invalidDateItem), false);
});

test('recencyOkay enforces reliable and lane-bounded recency', () => {
  const contextSource = { lane: 'context' };
  const incidentsSource = { lane: 'incidents' };

  assert.equal(recencyOkay(contextSource, null), false);
  assert.equal(recencyOkay(contextSource, 'not-a-date'), false);
  assert.equal(
    recencyOkay(contextSource, new Date(Date.now() - (9 * 24 * 60 * 60 * 1000)).toISOString()),
    true
  );
  assert.equal(
    recencyOkay(contextSource, new Date(Date.now() - (11 * 24 * 60 * 60 * 1000)).toISOString()),
    false
  );
  assert.equal(
    recencyOkay(incidentsSource, new Date(Date.now() - (6 * 24 * 60 * 60 * 1000)).toISOString()),
    true
  );
  assert.equal(
    recencyOkay(incidentsSource, new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString()),
    false
  );
});

test('discardReasonForItem marks missing/invalid date drops explicitly', () => {
  const source = {
    lane: 'context',
    provider: 'Official context source',
    isTrustedOfficial: true,
    requiresKeywordMatch: false
  };

  const missingDateItem = {
    title: 'Counter-terror briefing update',
    summary: 'Official update on terrorism prevention posture.',
    sourceExtract: 'Policy and operational context update.',
    published: null
  };

  const invalidDateItem = {
    ...missingDateItem,
    published: 'not-a-date'
  };

  assert.equal(discardReasonForItem(source, missingDateItem), 'missing-or-invalid-date');
  assert.equal(discardReasonForItem(source, invalidDateItem), 'missing-or-invalid-date');
});

test("renderHero shows requested fallback copy when live pull hasn't happened yet", () => {
  const state = {
    briefingMode: false,
    activeRegion: 'all',
    activeLane: 'all',
    liveFeedGeneratedAt: null,
    lastBrowserPollAt: null,
    liveSourceCount: 0,
    liveFetchedAlertCount: 0,
    alerts: []
  };
  const elements = {
    heroSearch: { value: '' },
    heroUpdated: { textContent: '' }
  };

  renderHero({ state, elements });

  assert.equal(elements.heroUpdated.textContent, 'Waiting for first live update');
});

test('renderHero uses last successful source count when current source count is zero', () => {
  const state = {
    briefingMode: false,
    activeRegion: 'all',
    activeLane: 'all',
    liveFeedGeneratedAt: new Date('2026-04-04T08:00:00.000Z'),
    lastBrowserPollAt: null,
    liveSourceCount: 0,
    liveFetchedAlertCount: 0,
    alerts: [],
    liveFeedHealth: {
      lastSuccessfulSourceCount: 118
    }
  };
  const elements = {
    heroSearch: { value: '' },
    heroUpdated: { textContent: '' }
  };

  renderHero({ state, elements });

  assert.match(elements.heroUpdated.textContent, /\| 118 sources \| last good unknown \| 0 articles$/);
});

test('renderHero reports rendered vs fetched article totals when they differ', () => {
  const state = {
    briefingMode: false,
    activeRegion: 'all',
    activeLane: 'all',
    liveFeedGeneratedAt: new Date('2026-04-04T08:00:00.000Z'),
    lastBrowserPollAt: null,
    liveSourceCount: 41,
    liveFetchedAlertCount: 41,
    alerts: Array.from({ length: 14 }, (_, index) => makeAlert({ id: `alert-${index}` })),
    liveFeedHealth: null
  };
  const elements = {
    heroSearch: { value: '' },
    heroUpdated: { textContent: '' }
  };

  renderHero({ state, elements });

  assert.match(elements.heroUpdated.textContent, /\| 41 sources \| last good unknown \| Showing 14 of 41 articles$/);
});

test('renderHero shows configured/checked/updated/failed counters and last successful build', () => {
  const state = {
    briefingMode: false,
    activeRegion: 'all',
    activeLane: 'all',
    liveFeedGeneratedAt: new Date('2026-04-04T08:00:00.000Z'),
    lastBrowserPollAt: null,
    liveSourceCount: 30,
    liveFetchedAlertCount: 2,
    alerts: [makeAlert({ id: 'alert-1' }), makeAlert({ id: 'alert-2' })],
    liveFeedHealth: {
      lastSuccessfulRefreshTime: '2026-04-04T07:55:00.000Z'
    },
    liveSourceRunStats: {
      totalConfiguredSources: 240,
      sourcesCheckedThisRun: 52,
      sourcesUpdatedThisRun: 11,
      sourcesFailedThisRun: 4,
      sourcesUnchangedThisRun: 8,
      lastSuccessfulGlobalBuild: '2026-04-04T07:55:00.000Z'
    }
  };
  const elements = {
    heroSearch: { value: '' },
    heroUpdated: { textContent: '' }
  };

  renderHero({ state, elements });

  assert.match(elements.heroUpdated.textContent, /\| cfg 240 \| chk 52 \| upd 11 \| fail 4 \| last good /);
});

test('normaliseSourcesPayload drops duplicate source IDs and keeps first occurrence', () => {
  const payload = {
    sources: [
      { id: 'a', endpoint: 'https://a.example', provider: 'A' },
      { id: 'b', endpoint: 'https://b.example', provider: 'B' },
      { id: 'a', endpoint: 'https://a2.example', provider: 'A2' }
    ]
  };

  const normalised = normaliseSourcesPayload(payload);

  assert.equal(normalised.length, 2);
  assert.equal(normalised[0].id, 'a');
  assert.equal(normalised[0].endpoint, 'https://a.example');
  assert.equal(normalised[1].id, 'b');
});

test('normaliseSourcesPayload drops duplicate endpoints and keeps first occurrence', () => {
  const payload = {
    sources: [
      { id: 'a', endpoint: 'https://example.test/a/', provider: 'A' },
      { id: 'b', endpoint: 'https://example.test/a', provider: 'B' },
      { id: 'c', endpoint: 'https://example.test/c', provider: 'C' }
    ]
  };

  const normalised = normaliseSourcesPayload(payload);

  assert.equal(normalised.length, 2);
  assert.equal(normalised[0].id, 'a');
  assert.equal(normalised[1].id, 'c');
});

test('source refresh cadence keeps incidents hourly and rotates lower-yield lanes', () => {
  const incidentsSource = {
    id: 'met-police-news',
    lane: 'incidents',
    kind: 'html'
  };
  const contextSource = {
    id: 'official-context-feed',
    lane: 'context',
    kind: 'html'
  };
  const baseHour = new Date('2026-04-05T10:00:00.000Z');
  const cadence = sourceRefreshEveryHours(contextSource);
  const offset = sourceRefreshOffset(contextSource);
  const baseHourSlot = Math.floor(baseHour.getTime() / 3600000);
  const deltaToRefresh = (offset - (baseHourSlot % cadence) + cadence) % cadence;
  const refreshHour = new Date(baseHour.getTime() + deltaToRefresh * 3600000);
  const nonRefreshHour = new Date(refreshHour.getTime() + 3600000);

  assert.equal(shouldRefreshSourceThisRun(incidentsSource, baseHour), true);
  assert.equal(shouldRefreshSourceThisRun(incidentsSource, nonRefreshHour), true);

  assert.equal(shouldRefreshSourceThisRun(contextSource, refreshHour), true);
  assert.equal(shouldRefreshSourceThisRun(contextSource, nonRefreshHour), false);
});

test('html source run cap is increased for candidate scheduler mode', () => {
  assert.equal(MAX_HTML_SOURCES_PER_RUN, 32);
});

test('html source run cap keeps control scheduler budget at legacy value', () => {
  assert.equal(CONTROL_MAX_HTML_SOURCES_PER_RUN, 24);
});

test('default fetch/runtime tuning constants remain stable', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 12000);
  assert.equal(DEFAULT_MAX_RETRIES, 3);
  assert.equal(FEED_SOURCE_CONCURRENCY, 4);
  assert.equal(MAX_HTML_PREFETCH_ITEMS, 12);
  assert.equal(MAX_FEED_PREFETCH_ITEMS, 8);
});

test('source error summary classifies HTTP 404 separately for direct quarantine routing', async () => {
  const { summariseSourceError } = await import('../scripts/build-live-feed/io.mjs');
  const summary = summariseSourceError(
    { id: 'test-source', provider: 'Test provider', endpoint: 'https://example.test/feed' },
    new Error('HTTP 404')
  );
  assert.equal(summary.category, 'not-found-404');
});

test('source error summary classifies HTTP 304 as unchanged', async () => {
  const { summariseSourceError } = await import('../scripts/build-live-feed/io.mjs');
  const summary = summariseSourceError(
    { id: 'test-source', provider: 'Test provider', endpoint: 'https://example.test/feed' },
    new Error('HTTP 304')
  );
  assert.equal(summary.category, 'unchanged-304');
});

test('source error summary prefers structured errorCode over brittle message matching', async () => {
  const { summariseSourceError } = await import('../scripts/build-live-feed/io.mjs');
  const error = new Error('mystery parser crash without selector words');
  error.__brialertMeta = { errorCode: 'PARSER_SELECTOR_OR_JS_RENDERING' };
  const summary = summariseSourceError(
    { id: 'test-source', provider: 'Test provider', endpoint: 'https://example.test/feed' },
    error
  );
  assert.equal(summary.errorCode, 'PARSER_SELECTOR_OR_JS_RENDERING');
  assert.equal(summary.category, 'brittle-selectors-or-js-rendering');
});

test('source error summary maps structured blocked and timeout codes centrally', async () => {
  const { summariseSourceError } = await import('../scripts/build-live-feed/io.mjs');
  const blockedError = new Error('opaque blocked page');
  blockedError.__brialertMeta = { errorCode: 'BLOCKED_ACCESS_PAGE' };
  const blockedSummary = summariseSourceError(
    { id: 'test-source', provider: 'Test provider', endpoint: 'https://example.test/feed' },
    blockedError
  );
  assert.equal(blockedSummary.category, 'blocked-or-auth');
  assert.equal(blockedSummary.errorCode, 'BLOCKED_ACCESS_PAGE');

  const timeoutError = new Error('upstream timeout');
  timeoutError.__brialertMeta = { errorCode: 'FETCH_TIMEOUT' };
  const timeoutSummary = summariseSourceError(
    { id: 'test-source', provider: 'Test provider', endpoint: 'https://example.test/feed' },
    timeoutError
  );
  assert.equal(timeoutSummary.category, 'timeout');
  assert.equal(timeoutSummary.errorCode, 'FETCH_TIMEOUT');
});

test('validate-live-feed-output script passes valid feed and fails invalid sourceCount', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brialert-live-feed-'));
  const scriptsDir = path.join(tmpRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'scripts', 'validate-live-feed-output.mjs'),
    path.join(scriptsDir, 'validate-live-feed-output.mjs')
  );

  const validPayload = {
    generatedAt: '2026-04-04T09:00:00.000Z',
    sourceCount: 3,
    alerts: [],
    health: {
      lastSuccessfulSourceCount: 3,
      lastAttemptedRefreshTime: '2026-04-04T09:00:00.000Z'
    }
  };
  fs.writeFileSync(path.join(tmpRoot, 'live-alerts.json'), JSON.stringify(validPayload));
  assert.doesNotThrow(() => {
    execFileSync('node', [path.join(scriptsDir, 'validate-live-feed-output.mjs')], { cwd: tmpRoot, stdio: 'pipe' });
  });

  const invalidPayload = {
    ...validPayload,
    sourceCount: -1
  };
  fs.writeFileSync(path.join(tmpRoot, 'live-alerts.json'), JSON.stringify(invalidPayload));
  assert.throws(() => {
    execFileSync('node', [path.join(scriptsDir, 'validate-live-feed-output.mjs')], { cwd: tmpRoot, stdio: 'pipe' });
  }, /sourceCount must be a non-negative number/);
});

test('createState initialises progressive story visibility defaults', () => {
  const state = createState({ transport: 'Transport hubs' });
  assert.equal(state.feedVisibleCount, INITIAL_RESPONDER_VISIBLE);
  assert.equal(state.supportingVisibleCount, INITIAL_SUPPORTING_VISIBLE);
});

test('deriveView keeps full quarantine list for progressive rendering', () => {
  const alerts = Array.from({ length: 10 }, (_, index) => makeAlert({
    id: `q-${index}`,
    title: `Weak secondary signal ${index}`,
    source: 'Reuters',
    sourceTier: 'corroboration',
    reliabilityProfile: 'major_media',
    isOfficial: false,
    confidenceScore: 0.71,
    needsHumanReview: true,
    queueReason: 'Needs human review',
    queueBucket: 'quarantine'
  }));
  const view = deriveView({
    alerts,
    activeRegion: 'all',
    activeLane: 'all'
  }, {
    sortAlertsByFreshness: (items) => items
  });
  assert.equal(view.quarantine.length, 10);
});

test('deriveView trusts upstream lanes for incidents vs context', () => {
  const responderIncident = makeAlert({
    id: 'incident-live',
    lane: 'incidents',
    queueReason: 'Trigger-tier terrorism incident candidate',
    queueBucket: 'responder'
  });
  const quarantinedIncident = makeAlert({
    id: 'incident-quarantine',
    lane: 'incidents',
    queueReason: 'Needs human review',
    needsHumanReview: true,
    isOfficial: false,
    confidenceScore: 0.7,
    queueBucket: 'quarantine'
  });
  const contextItem = makeAlert({
    id: 'context-upstream',
    lane: 'context',
    queueReason: 'Corroborating or adjacent source kept out of the live trigger lane.',
    queueBucket: 'context'
  });

  const view = deriveView({
    alerts: [responderIncident, quarantinedIncident, contextItem],
    activeRegion: 'all',
    activeLane: 'all'
  }, {
    sortAlertsByFreshness: (items) => items
  });

  assert.deepEqual(view.responder.map((item) => item.id), ['incident-live']);
  assert.deepEqual(view.quarantine.map((item) => item.id), ['incident-quarantine']);
  assert.deepEqual(view.context.map((item) => item.id), ['context-upstream']);
});

test('deriveView treats missing queue bucket as context for safe fallback', () => {
  const noBucket = makeAlert({
    id: 'no-bucket',
    lane: 'incidents'
  });
  const view = deriveView({
    alerts: [noBucket],
    activeRegion: 'all',
    activeLane: 'all'
  }, {
    sortAlertsByFreshness: (items) => items
  });
  assert.deepEqual(view.context.map((item) => item.id), ['no-bucket']);
  assert.equal(view.responder.length, 0);
  assert.equal(view.quarantine.length, 0);
});

test('normaliseAlert preserves canonical non-UK regions', () => {
  assert.equal(makeAlert({ region: 'eu' }).region, 'eu');
  assert.equal(makeAlert({ region: 'europe' }).region, 'europe');
  assert.equal(makeAlert({ region: 'us' }).region, 'us');
  assert.equal(makeAlert({ region: 'international' }).region, 'international');
});

test('filteredMapView respects pre-filtered region view data', () => {
  const londonAlert = makeAlert({ id: 'london-1', region: 'london', location: 'London' });
  const euAlert = makeAlert({ id: 'eu-1', region: 'eu', location: 'Paris' });
  const state = {
    alerts: [londonAlert, euAlert],
    activeLane: 'all',
    searchQuery: '',
    mapViewMode: 'world'
  };
  const view = {
    filtered: [londonAlert],
    responder: [],
    context: [],
    quarantine: [],
    topPriority: null
  };
  const result = filteredMapView(state, view);
  assert.deepEqual(result.filtered.map((item) => item.id), ['london-1']);
});

test('renderSupporting merges context and quarantine into one progressive list', () => {
  const makeButton = () => {
    const classes = new Set(['hidden']);
    return {
      textContent: '',
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        }
      },
      hasClass(name) {
        return classes.has(name);
      }
    };
  };

  const supportingLoadMore = makeButton();
  const state = {
    supportingVisibleCount: 2,
    alerts: []
  };
  const view = {
    context: [
      makeAlert({ id: 'c1', lane: 'context', publishedAt: '2026-04-04T10:01:00.000Z' }),
      makeAlert({ id: 'c2', lane: 'context', publishedAt: '2026-04-04T10:02:00.000Z' }),
      makeAlert({ id: 'c3', lane: 'context', publishedAt: '2026-04-04T10:03:00.000Z' })
    ],
    quarantine: [makeAlert({ id: 'q1', needsHumanReview: true }), makeAlert({ id: 'q2', needsHumanReview: true }), makeAlert({ id: 'q3', needsHumanReview: true })]
  };
  const elements = {
    supportingCount: { textContent: '' },
    supportingList: {
      innerHTML: '',
      querySelectorAll() {
        return [];
      }
    },
    supportingLoadMore
  };
  const modalController = { openDetail() {} };

  renderSupporting({ elements, view, state, modalController });

  assert.equal(elements.supportingCount.textContent, '2/6 items');
  assert.match(elements.supportingList.innerHTML, /Quarantine|Context/i);
  assert.equal(supportingLoadMore.hasClass('hidden'), false);
});

test('addSourceRequest accepts valid http/https links and stores newest first', () => {
  const requests = [];
  const result = addSourceRequest(requests, 'https://example.com/news', new Date('2026-04-04T12:00:00.000Z'));
  assert.equal(result.ok, true);
  assert.equal(result.message, 'Source request saved.');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.com/news');
  assert.equal(requests[0].requestedAt, '2026-04-04T12:00:00.000Z');
});

test('addSourceRequest rejects invalid and duplicate links', () => {
  const requests = [{ url: 'https://example.com/news', requestedAt: '2026-04-04T12:00:00.000Z' }];
  assert.equal(addSourceRequest(requests, '').ok, false);
  assert.equal(addSourceRequest(requests, 'not-a-link').ok, false);
  assert.equal(addSourceRequest(requests, 'javascript:alert(1)').ok, false);
  const duplicate = addSourceRequest(requests, 'https://example.com/news');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.message, 'That source link has already been requested.');
  assert.equal(requests.length, 1);
});
