import { isLondonAlert } from './alert-view-model.mjs';

function searchTerms(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
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
    (state.activeRegion === 'all' || (state.activeRegion === 'london' ? isLondonAlert(alert) : alert.region === state.activeRegion)) &&
    (state.activeLane === 'all' || alert.lane === state.activeLane) &&
    matchesAlertSearch(alert, state.searchQuery)
  );
}

export function deriveView(state, deps) {
  const filtered = filteredAlerts(state);
  const responder = deps.sortAlertsByFreshness(filtered.filter(deps.isLiveIncidentCandidate));
  const context = deps.sortAlertsByFreshness(filtered.filter((alert) => {
    if (deps.isQuarantineCandidate(alert)) return false;
    if (alert.lane === 'incidents' && !deps.isTerrorRelevant(alert)) return false;
    return !deps.isLiveIncidentCandidate(alert);
  }));
  const quarantine = deps.sortAlertsByFreshness(filtered.filter(deps.isQuarantineCandidate));
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
  const feedHealth = health && typeof health === 'object' ? health : {};
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
  } catch {
    state.geoLookup = [];
  }
}

export async function loadWatchGeography(state, url) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.watchGeographySites = Array.isArray(data) ? data : [];
  } catch {
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

  return {
    alerts,
    fetchedAlertCount,
    generatedAt,
    sourceCount,
    health: payload && typeof payload.health === 'object' && payload.health ? payload.health : null
  };
}

export async function loadLiveFeed(state, options) {
  const { liveFeedUrl, normaliseAlert, onAfterLoad } = options;
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
    state.liveFeedFetchError = null;
  } catch (error) {
    state.alerts = previousAlerts;
    state.liveFeedGeneratedAt = previousGeneratedAt;
    state.liveSourceCount = previousSourceCount;
    state.liveFetchedAlertCount = previousFetchedAlertCount;
    state.liveFeedHealth = previousHealth;
    state.liveFeedFetchError = {
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString()
    };
  }
  state.lastBrowserPollAt = new Date();
  if (typeof onAfterLoad === 'function') onAfterLoad();
}
