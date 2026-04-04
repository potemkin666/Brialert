function alertTimeMsForMap(alert) {
  const raw = alert.publishedAt || alert.happenedWhen || alert.time;
  if (!raw) return 0;
  const stamp = new Date(raw).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function timelineWindowMs(windowKey) {
  if (windowKey === '24h') return 24 * 60 * 60 * 1000;
  if (windowKey === '72h') return 72 * 60 * 60 * 1000;
  if (windowKey === '7d') return 7 * 24 * 60 * 60 * 1000;
  return Infinity;
}

function timelineLabel(windowKey) {
  if (windowKey === '24h') return 'last 24h';
  if (windowKey === '72h') return 'last 72h';
  if (windowKey === '7d') return 'last 7d';
  return 'all time';
}

export function filteredMapView(state, view) {
  const windowMs = timelineWindowMs(state.mapTimelineWindow);
  const now = Date.now();

  const filtered = view.filtered.filter((alert) => {
    if (windowMs !== Infinity) {
      const stamp = alertTimeMsForMap(alert);
      if (!stamp || now - stamp > windowMs) return false;
    }
    return true;
  });

  return {
    ...view,
    filtered,
    mapFilterLabels: [timelineLabel(state.mapTimelineWindow)]
  };
}

export function renderMapIfActive({ state, view, mapController }) {
  if (state.activeTab === 'map') {
    mapController.renderMap(state, filteredMapView(state, view));
  }
}
