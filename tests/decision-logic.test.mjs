import test from 'node:test';
import assert from 'node:assert/strict';

import { coerceLiveFeedPayload, deriveFeedHealthStatus, deriveView } from '../shared/feed-controller.mjs';
import {
  isLiveIncidentCandidate,
  isQuarantineCandidate,
  normaliseAlert
} from '../shared/alert-view-model.mjs';
import {
  inferIncidentTrack,
  isTerrorRelevantIncident
} from '../shared/taxonomy.mjs';
import {
  fusedIncidentIdFor,
  mergeCorroboratingSources
} from '../shared/fusion.mjs';
import { buildHealthBlock } from '../scripts/build-live-feed.mjs';

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
    queueReason: 'Needs human review'
  });

  const liveOfficial = makeAlert();
  const state = {
    alerts: [liveOfficial, weakSecondary],
    activeRegion: 'all',
    activeLane: 'all'
  };

  const view = deriveView(state, {
    sortAlertsByFreshness: (alerts) => alerts,
    isLiveIncidentCandidate,
    isQuarantineCandidate,
    isTerrorRelevant: (alert) => alert.isTerrorRelevant
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

test('live feed coercion keeps valid alerts and drops malformed ones', () => {
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

  assert.equal(payload.alerts.length, 1);
  assert.equal(payload.alerts[0].id, 'good-1');
});
