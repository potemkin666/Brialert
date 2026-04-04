import { isLondonAlert } from './alert-view-model.mjs';

export function filteredAlerts(state) {
  return state.alerts.filter((alert) =>
    (state.activeRegion === 'all' || (state.activeRegion === 'london' ? isLondonAlert(alert) : alert.region === state.activeRegion)) &&
    (state.activeLane === 'all' || alert.lane === state.activeLane)
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
  const quarantine = deps.sortAlertsByFreshness(filtered.filter(deps.isQuarantineCandidate)).slice(0, 6);
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
  const generatedAt = payload.generatedAt || payload.updatedAt || payload.alertData?.timestamp || null;
  const sourceCount = Number(payload.sourceCount ?? payload.alertData?.sourceCount ?? 0);
  const validLanes = new Set(['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention']);
  const validRegions = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);
  const validSourceTiers = new Set(['trigger', 'corroboration', 'context', 'research']);
  const validReliabilityProfiles = new Set([
    'official_ct',
    'official_general',
    'official_context',
    'major_media',
    'general_media',
    'tabloid',
    'specialist_research'
  ]);
  const validIncidentTracks = new Set(['live', 'case']);
  const isValidTimestamp = typeof generatedAt === 'string' && !Number.isNaN(new Date(generatedAt).getTime());
  const hasNumericSourceCount = Number.isFinite(sourceCount) && sourceCount >= 0;

  function isRenderableAlert(alert) {
    if (!alert || typeof alert !== 'object') return false;
    if (typeof alert.id !== 'string' || !alert.id.trim()) return false;
    if (typeof alert.title !== 'string' || !alert.title.trim()) return false;
    if (typeof alert.summary !== 'string' || !alert.summary.trim()) return false;
    if (typeof alert.source !== 'string' || !alert.source.trim()) return false;
    if (typeof alert.sourceUrl !== 'string' || !alert.sourceUrl.trim()) return false;
    if (typeof alert.location !== 'string' || !alert.location.trim()) return false;
    if (!validLanes.has(alert.lane)) return false;
    if (!validRegions.has(alert.region)) return false;
    if (typeof alert.sourceTier !== 'string' || !validSourceTiers.has(alert.sourceTier)) return false;
    if (typeof alert.reliabilityProfile !== 'string' || !validReliabilityProfiles.has(alert.reliabilityProfile)) return false;
    if (alert.lane === 'incidents') {
      if (typeof alert.incidentTrack !== 'string' || !validIncidentTracks.has(alert.incidentTrack)) return false;
      if (typeof alert.isTerrorRelevant !== 'boolean') return false;
      if (!Array.isArray(alert.keywordHits)) return false;
      if (!Array.isArray(alert.terrorismHits)) return false;
      if (typeof alert.queueReason !== 'string' || !alert.queueReason.trim()) return false;
      if (typeof alert.laneReason !== 'string' || !alert.laneReason.trim()) return false;
    }
    return true;
  }

  const renderableAlerts = alerts.filter(isRenderableAlert);

  if (!Array.isArray(payload.alerts)) {
    throw new Error('Live feed payload is missing an alerts array.');
  }

  if (!isValidTimestamp) {
    throw new Error('Live feed payload is missing a valid generatedAt timestamp.');
  }

  if (!hasNumericSourceCount) {
    throw new Error('Live feed payload is missing a valid sourceCount.');
  }

  return {
    alerts: renderableAlerts,
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
  const previousHealth = state.liveFeedHealth;
  try {
    const response = await fetch(`${liveFeedUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = coerceLiveFeedPayload(await response.json());
    state.alerts = data.alerts.map((alert, index) => normaliseAlert(alert, index, state.geoLookup));
    state.liveFeedGeneratedAt = data.generatedAt ? new Date(data.generatedAt) : new Date();
    state.liveSourceCount = data.sourceCount;
    state.liveFeedHealth = data.health;
    state.liveFeedFetchError = null;
  } catch (error) {
    state.alerts = previousAlerts;
    state.liveFeedGeneratedAt = previousGeneratedAt;
    state.liveSourceCount = previousSourceCount;
    state.liveFeedHealth = previousHealth;
    state.liveFeedFetchError = {
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString()
    };
  }
  state.lastBrowserPollAt = new Date();
  if (typeof onAfterLoad === 'function') onAfterLoad();
}
