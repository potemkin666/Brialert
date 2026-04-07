import { isLondonAlert } from './alert-view-model.mjs';
import { LANE_ALL, MAP_VIEW_MODES, QUEUE_BUCKETS } from './ui-constants.mjs';
import { reportBackgroundError } from './logger.mjs';

function searchTerms(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normaliseHealthSnapshot(health) {
  if (!health || typeof health !== 'object') return null;
  const staleAfterMinutes = Number(health.staleAfterMinutes);
  const lastSuccessfulSourceCount = Number(health.lastSuccessfulSourceCount);
  const sourceRunStats = health.sourceRunStats && typeof health.sourceRunStats === 'object'
    ? health.sourceRunStats
    : {};
  return {
    staleAfterMinutes: Number.isFinite(staleAfterMinutes) && staleAfterMinutes > 0 ? staleAfterMinutes : null,
    lastSuccessfulRefreshTime: typeof health.lastSuccessfulRefreshTime === 'string' ? health.lastSuccessfulRefreshTime : null,
    lastSuccessfulRunId: typeof health.lastSuccessfulRunId === 'string' ? health.lastSuccessfulRunId : null,
    lastSuccessfulSourceCount: Number.isFinite(lastSuccessfulSourceCount) && lastSuccessfulSourceCount >= 0
      ? lastSuccessfulSourceCount
      : 0,
    hasWarnings: Boolean(health.hasWarnings),
    usedFallback: Boolean(health.usedFallback),
    sourceRunStats: {
      totalConfiguredSources: Number(sourceRunStats.totalConfiguredSources || 0),
      sourcesCheckedThisRun: Number(sourceRunStats.sourcesCheckedThisRun || 0),
      sourcesUpdatedThisRun: Number(sourceRunStats.sourcesUpdatedThisRun || 0),
      sourcesFailedThisRun: Number(sourceRunStats.sourcesFailedThisRun || 0),
      sourcesUnchangedThisRun: Number(sourceRunStats.sourcesUnchangedThisRun || 0)
    }
  };
}

export function normaliseRenderState(state) {
  const next = state && typeof state === 'object' ? state : {};
  const watched = next.watched instanceof Set ? next.watched : new Set();
  return {
    ...next,
    alerts: Array.isArray(next.alerts) ? next.alerts : [],
    searchQuery: String(next.searchQuery || ''),
    activeRegion: String(next.activeRegion || LANE_ALL),
    activeLane: String(next.activeLane || LANE_ALL),
    mapViewMode: String(next.mapViewMode || MAP_VIEW_MODES.london),
    watched,
    notes: Array.isArray(next.notes) ? next.notes : [],
    sourceRequests: Array.isArray(next.sourceRequests) ? next.sourceRequests : [],
    feedVisibleCount: Math.max(1, Number(next.feedVisibleCount || 0)),
    supportingVisibleCount: Math.max(1, Number(next.supportingVisibleCount || 0)),
    liveSourceCount: Number.isFinite(Number(next.liveSourceCount)) ? Number(next.liveSourceCount) : 0,
    liveFetchedAlertCount: Number.isFinite(Number(next.liveFetchedAlertCount)) ? Number(next.liveFetchedAlertCount) : 0,
    liveFeedGeneratedAt: next.liveFeedGeneratedAt instanceof Date ? next.liveFeedGeneratedAt : null,
    liveFeedHealth: normaliseHealthSnapshot(next.liveFeedHealth),
    liveSourceRunStats: next.liveSourceRunStats && typeof next.liveSourceRunStats === 'object'
      ? {
          totalConfiguredSources: Number(next.liveSourceRunStats.totalConfiguredSources || 0),
          sourcesCheckedThisRun: Number(next.liveSourceRunStats.sourcesCheckedThisRun || 0),
          sourcesUpdatedThisRun: Number(next.liveSourceRunStats.sourcesUpdatedThisRun || 0),
          sourcesFailedThisRun: Number(next.liveSourceRunStats.sourcesFailedThisRun || 0),
          sourcesUnchangedThisRun: Number(next.liveSourceRunStats.sourcesUnchangedThisRun || 0),
          lastSuccessfulGlobalBuild: next.liveSourceRunStats.lastSuccessfulGlobalBuild || null
        }
      : null,
    liveFeedFetchError: next.liveFeedFetchError && typeof next.liveFeedFetchError === 'object'
      ? {
          message: String(next.liveFeedFetchError.message || ''),
          at: String(next.liveFeedFetchError.at || '')
        }
      : null,
    liveFeedFetchState: ['idle', 'loading', 'success', 'error'].includes(String(next.liveFeedFetchState || ''))
      ? String(next.liveFeedFetchState)
      : 'idle',
    liveFeedLastAttemptAt: typeof next.liveFeedLastAttemptAt === 'string'
      ? next.liveFeedLastAttemptAt
      : null,
    manualRefreshTriggerStatus: next.manualRefreshTriggerStatus && typeof next.manualRefreshTriggerStatus === 'object'
      ? {
          state: ['idle', 'pending', 'success', 'error'].includes(String(next.manualRefreshTriggerStatus.state || ''))
            ? String(next.manualRefreshTriggerStatus.state)
            : 'idle',
          message: next.manualRefreshTriggerStatus.message
            ? String(next.manualRefreshTriggerStatus.message)
            : null,
          at: next.manualRefreshTriggerStatus.at
            ? String(next.manualRefreshTriggerStatus.at)
            : null,
          apiUrl: next.manualRefreshTriggerStatus.apiUrl
            ? String(next.manualRefreshTriggerStatus.apiUrl)
            : null
        }
      : {
          state: 'idle',
          message: null,
          at: null,
          apiUrl: null
        }
  };
}

function alertSearchText(alert) {
  const fields = [
    alert?.title,
    alert?.summary,
    alert?.source,
    alert?.location,
    alert?.status,
    alert?.aiSummary,
    alert?.sourceExtract,
    alert?.laneReason,
    alert?.queueReason,
    alert?.actor,
    alert?.region,
    alert?.lane
  ];

  if (Array.isArray(alert?.keywordHits)) fields.push(alert.keywordHits.join(' '));
  if (Array.isArray(alert?.terrorismHits)) fields.push(alert.terrorismHits.join(' '));
  if (Array.isArray(alert?.peopleInvolved)) fields.push(alert.peopleInvolved.join(' '));

  return fields
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
}

export function matchesAlertSearch(alert, query) {
  const terms = searchTerms(query);
  if (!terms.length) return true;
  const haystack = alertSearchText(alert);
  return terms.every((term) => haystack.includes(term));
}

export function filteredAlerts(state) {
  return state.alerts.filter((alert) =>
    (state.activeRegion === LANE_ALL || (state.activeRegion === MAP_VIEW_MODES.london ? isLondonAlert(alert) : alert.region === state.activeRegion)) &&
    (state.activeLane === LANE_ALL || alert.lane === state.activeLane) &&
    matchesAlertSearch(alert, state.searchQuery)
  );
}

export function deriveView(state, deps) {
  const normalisedState = normaliseRenderState(state);
  const filtered = filteredAlerts(normalisedState);
  const responder = deps.sortAlertsByFreshness(filtered.filter((alert) => {
    const queueBucket = String(alert?.queueBucket || '').toLowerCase();
    return queueBucket === QUEUE_BUCKETS.responder;
  }));
  const quarantine = deps.sortAlertsByFreshness(filtered.filter((alert) => {
    const queueBucket = String(alert?.queueBucket || '').toLowerCase();
    return queueBucket === QUEUE_BUCKETS.quarantine;
  }));
  const context = deps.sortAlertsByFreshness(filtered.filter((alert) => {
    const queueBucket = String(alert?.queueBucket || '').toLowerCase();
    return queueBucket === ''
      || (queueBucket !== QUEUE_BUCKETS.responder && queueBucket !== QUEUE_BUCKETS.quarantine);
  }));
  const topPriority = responder[0] || context[0] || null;

  return { filtered, responder, context, quarantine, topPriority };
}

export function deriveFeedHealthStatus({
  health,
  generatedAt,
  sourceCount,
  fetchError,
  now = Date.now(),
  defaultStaleAfterMinutes = 22
}) {
  const feedHealth = normaliseHealthSnapshot(health) || {};
  const staleAfterMinutes = Number(feedHealth.staleAfterMinutes || defaultStaleAfterMinutes);
  const lastRefresh = feedHealth.lastSuccessfulRefreshTime
    ? new Date(feedHealth.lastSuccessfulRefreshTime)
    : generatedAt || null;
  const lastRefreshMs = lastRefresh instanceof Date ? lastRefresh.getTime() : NaN;
  const isStale = Number.isFinite(lastRefreshMs)
    ? (now - lastRefreshMs) > staleAfterMinutes * 60_000
    : false;

  return {
    visible: Boolean(lastRefresh || fetchError),
    isStale,
    isFetchError: Boolean(fetchError),
    hasWarnings: Boolean(feedHealth.hasWarnings),
    usedFallback: Boolean(feedHealth.usedFallback),
    lastRefresh,
    runId: feedHealth.lastSuccessfulRunId || 'unknown',
    sourceCount: Number(feedHealth.lastSuccessfulSourceCount || sourceCount || 0)
  };
}

export async function loadGeoLookup(state, url) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.geoLookup = Array.isArray(data) ? data : [];
  } catch (error) {
    reportBackgroundError('feed', `loadGeoLookup failed for ${url}`, error, { url, operation: 'loadGeoLookup' });
    state.geoLookup = [];
  }
}

export async function loadWatchGeography(state, url) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.watchGeographySites = Array.isArray(data) ? data : [];
  } catch (error) {
    reportBackgroundError('feed', `loadWatchGeography failed for ${url}`, error, { url, operation: 'loadWatchGeography' });
    state.watchGeographySites = [];
  }
}

export function coerceLiveFeedPayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const fetchedAlertCount = Number(payload.alertCount ?? alerts.length);
  const generatedAt = payload.generatedAt || payload.updatedAt || payload.alertData?.timestamp || null;
  const sourceCount = Number(payload.sourceCount ?? payload.alertData?.sourceCount ?? 0);
  const isValidTimestamp = typeof generatedAt === 'string' && !Number.isNaN(new Date(generatedAt).getTime());
  const hasNumericSourceCount = Number.isFinite(sourceCount) && sourceCount >= 0;

  if (!Array.isArray(payload.alerts)) {
    throw new Error('Live feed payload is missing an alerts array.');
  }

  if (!isValidTimestamp) {
    throw new Error('Live feed payload is missing a valid generatedAt timestamp.');
  }

  if (!hasNumericSourceCount) {
    throw new Error('Live feed payload is missing a valid sourceCount.');
  }

  if (!Number.isFinite(fetchedAlertCount) || fetchedAlertCount < 0) {
    throw new Error('Live feed payload is missing a valid alertCount.');
  }

  if (fetchedAlertCount < alerts.length) {
    throw new Error('Live feed payload alertCount cannot be lower than alerts array length.');
  }

  if (alerts.some((alert) => !alert || typeof alert !== 'object')) {
    throw new Error('Live feed payload contains malformed alert entries.');
  }

  return {
    alerts,
    fetchedAlertCount,
    generatedAt,
    sourceCount,
    health: normaliseHealthSnapshot(payload.health)
  };
}

export async function loadLiveFeed(state, options) {
  const { liveFeedUrl, normaliseAlert, onAfterLoad } = options;
  const startedAtIso = new Date().toISOString();
  console.info(`[feed] Fetch start: ${liveFeedUrl}`);
  state.liveFeedFetchState = 'loading';
  state.liveFeedLastAttemptAt = startedAtIso;
  const previousAlerts = state.alerts;
  const previousGeneratedAt = state.liveFeedGeneratedAt;
  const previousSourceCount = state.liveSourceCount;
  const previousFetchedAlertCount = state.liveFetchedAlertCount || 0;
  const previousHealth = state.liveFeedHealth;
  try {
    const response = await fetch(`${liveFeedUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = coerceLiveFeedPayload(await response.json());
    state.alerts = data.alerts.map((alert, index) => normaliseAlert(alert, index, state.geoLookup));
    state.liveFetchedAlertCount = data.fetchedAlertCount;
    state.liveFeedGeneratedAt = data.generatedAt ? new Date(data.generatedAt) : new Date();
    state.liveFeedHealth = data.health;
    const sourceCount = Number(data.sourceCount);
    const successfulSourceCount = Number(data.health?.lastSuccessfulSourceCount);
    state.liveSourceCount = Number.isFinite(sourceCount) && sourceCount > 0
      ? sourceCount
      : (Number.isFinite(successfulSourceCount) && successfulSourceCount > 0 ? successfulSourceCount : 0);
    const runStats = data.health?.sourceRunStats && typeof data.health.sourceRunStats === 'object'
      ? data.health.sourceRunStats
      : {};
    state.liveSourceRunStats = {
      totalConfiguredSources: Number(runStats.totalConfiguredSources || 0),
      sourcesCheckedThisRun: Number(runStats.sourcesCheckedThisRun || 0),
      sourcesUpdatedThisRun: Number(runStats.sourcesUpdatedThisRun || 0),
      sourcesFailedThisRun: Number(runStats.sourcesFailedThisRun || 0),
      sourcesUnchangedThisRun: Number(runStats.sourcesUnchangedThisRun || 0),
      lastSuccessfulGlobalBuild: data.health?.lastSuccessfulRefreshTime || null
    };
    state.liveFeedFetchState = 'success';
    state.liveFeedFetchError = null;
    console.info(`[feed] Fetch success: generatedAt=${data.generatedAt} alerts=${state.alerts.length}/${data.fetchedAlertCount}`);
  } catch (error) {
    state.alerts = previousAlerts;
    state.liveFeedGeneratedAt = previousGeneratedAt;
    state.liveSourceCount = previousSourceCount;
    state.liveFetchedAlertCount = previousFetchedAlertCount;
    state.liveFeedHealth = previousHealth;
    state.liveFeedFetchState = 'error';
    state.liveFeedFetchError = {
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString()
    };
    console.error(`[feed] Fetch failed: ${liveFeedUrl}`, error);
  }
  state.lastBrowserPollAt = new Date();
  if (typeof onAfterLoad === 'function') onAfterLoad();
}
