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
  const topPriority = state.strictResponderMode
    ? responder.filter(deps.isStrictTopAlertCandidate)[0] || null
    : (responder[0] || context[0] || null);

  return { filtered, responder, context, quarantine, topPriority };
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

export async function loadLiveFeed(state, options) {
  const { liveFeedUrl, normaliseAlert, onAfterLoad } = options;
  try {
    const response = await fetch(`${liveFeedUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.alerts = Array.isArray(data.alerts)
      ? data.alerts.map((alert, index) => normaliseAlert(alert, index, state.geoLookup))
      : [];
    state.liveFeedGeneratedAt = data.generatedAt ? new Date(data.generatedAt) : new Date();
    state.liveSourceCount = Number(data.sourceCount || 0);
  } catch {
    state.alerts = [];
    state.liveFeedGeneratedAt = null;
    state.liveSourceCount = 0;
  }
  state.lastBrowserPollAt = new Date();
  if (typeof onAfterLoad === 'function') onAfterLoad();
}
