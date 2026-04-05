const LONDON_CENTER = Object.freeze([51.5074, -0.1278]);
const LONDON_BOUNDS = Object.freeze([
  [51.28, -0.52],
  [51.7, 0.24]
]);
const INITIAL_LONDON_ZOOM = 12;
const WORLD_FALLBACK = Object.freeze({ center: [20, 10], zoom: 2 });
const LONDON_CLUSTER_MAX_ZOOM = 12;
const WORLD_CLUSTER_MAX_ZOOM = 7;

function statusLine(mode, count) {
  if (count <= 0) return 'No alerts in current view';
  const countLabel = `${count} alert${count === 1 ? '' : 's'}`;
  if (mode === 'london') return `${countLabel} in London`;
  return `${countLabel} in last 24h`;
}

function severityClass(alert) {
  const severity = String(alert?.severity || '').toLowerCase();
  if (severity === 'critical' || severity === 'high' || severity === 'elevated') return severity;
  return 'moderate';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markerPopup(alert) {
  return `
    <div class="map-preview-card">
      <strong>${escapeHtml(alert.title)}</strong>
      <p>${escapeHtml(alert.location || 'Unknown location')}</p>
      <div class="map-preview-meta">
        <span>${escapeHtml(alert.source || '')}</span>
        <span>${escapeHtml(alert.time || '')}</span>
      </div>
      <button class="map-preview-button" type="button" data-open-detail="${escapeHtml(alert.id)}">Open detail</button>
    </div>`;
}

function clusterSeverity(items) {
  let best = 'moderate';
  for (const item of items) {
    const severity = String(item?.severity || '').toLowerCase();
    if (severity === 'critical') return 'critical';
    if (severity === 'high') best = best === 'moderate' ? 'high' : best;
    if (severity === 'elevated' && best === 'moderate') best = 'elevated';
  }
  return best;
}

function clusterThreshold(zoom) {
  if (zoom <= 3) return 52;
  if (zoom <= 5) return 40;
  if (zoom <= 7) return 30;
  return 24;
}

export function createMapController(config) {
  const { mapElement, mapStatusLine, mapEmptyState, openDetail } = config;
  let liveMap = null;
  let layers = [];
  let lastSignature = '';
  let lastMode = 'london';
  let lastState = null;
  let lastView = null;
  let hasInitialLondonFrame = false;

  function ensureMap() {
    if (liveMap || !mapElement || typeof L === 'undefined') return;
    liveMap = L.map(mapElement, {
      center: LONDON_CENTER,
      zoom: 11,
      minZoom: 2,
      maxZoom: 13,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(liveMap);
    liveMap.on('zoomend', () => {
      if (!lastState || !lastView) return;
      renderMap(lastState, lastView, false);
    });
  }

  function mapIconForAlert(alert) {
    const level = severityClass(alert);
    return L.divIcon({
      className: 'map-dot-icon',
      html: `<span class="map-dot map-dot--${level}" aria-hidden="true"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -8]
    });
  }

  function clusterIconFor(items) {
    const level = clusterSeverity(items);
    const size = items.length >= 20 ? 40 : items.length >= 10 ? 36 : 32;
    return L.divIcon({
      className: 'map-cluster-icon',
      html: `<span class="map-cluster map-cluster--${level}" style="width:${size}px;height:${size}px;">${items.length}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  function clearLayers() {
    layers.forEach((layer) => layer.remove());
    layers = [];
  }

  function clusterAlerts(items) {
    if (!liveMap || items.length <= 1) return items.map((alert) => ({ type: 'single', alert }));
    const zoom = liveMap.getZoom();
    const threshold = clusterThreshold(zoom);
    const clusters = [];

    items.forEach((alert) => {
      const point = liveMap.project([alert.lat, alert.lng], zoom);
      const match = clusters.find((cluster) => {
        const dx = cluster.center.x - point.x;
        const dy = cluster.center.y - point.y;
        return Math.hypot(dx, dy) <= threshold;
      });
      if (match) {
        match.items.push(alert);
        const total = match.items.length;
        match.center.x = ((match.center.x * (total - 1)) + point.x) / total;
        match.center.y = ((match.center.y * (total - 1)) + point.y) / total;
      } else {
        clusters.push({
          center: { x: point.x, y: point.y },
          items: [alert]
        });
      }
    });

    return clusters.map((cluster) => {
      if (cluster.items.length === 1) return { type: 'single', alert: cluster.items[0] };
      const latLng = liveMap.unproject(L.point(cluster.center.x, cluster.center.y), zoom);
      return { type: 'cluster', lat: latLng.lat, lng: latLng.lng, items: cluster.items };
    });
  }

  function fitForMode(mode, points) {
    if (!liveMap) return;
    if (mode === 'london') {
      if (points.length) {
        liveMap.fitBounds(L.latLngBounds(points), { padding: [22, 22], maxZoom: 12 });
      } else {
        liveMap.fitBounds(LONDON_BOUNDS, { padding: [14, 14], maxZoom: 11 });
      }
      return;
    }

    if (points.length) {
      liveMap.fitBounds(L.latLngBounds(points), { padding: [26, 26], maxZoom: 4 });
    } else {
      liveMap.setView(WORLD_FALLBACK.center, WORLD_FALLBACK.zoom);
    }
  }

  function renderMap(state, view, forceFit = false) {
    ensureMap();
    if (!liveMap) return;
    lastState = state;
    lastView = view;
    const mode = state.mapViewMode === 'world' ? 'world' : 'london';
    const items = view.filtered.filter((alert) => Number.isFinite(alert.lat) && Number.isFinite(alert.lng));
    const signature = `${mode}:${liveMap.getZoom()}:${items.map((item) => `${item.id}:${item.lat.toFixed(3)},${item.lng.toFixed(3)}`).join('|')}`;
    if (!forceFit && signature === lastSignature) return;
    lastSignature = signature;
    lastMode = mode;

    clearLayers();
    const points = [];
    const clustered = clusterAlerts(items);
    clustered.forEach((entry) => {
      if (entry.type === 'single') {
        const alert = entry.alert;
        const marker = L.marker([alert.lat, alert.lng], {
          icon: mapIconForAlert(alert),
          keyboard: true,
          title: alert.title
        });
        marker.bindPopup(markerPopup(alert), { className: 'map-preview-popup-shell' });
        marker.on('popupopen', (event) => {
          const popupElement = event.popup?.getElement();
          const button = popupElement?.querySelector(`[data-open-detail="${alert.id}"]`);
          if (!button) return;
          button.addEventListener('click', () => openDetail(alert), { once: true });
        });
        marker.addTo(liveMap);
        layers.push(marker);
        points.push([alert.lat, alert.lng]);
        return;
      }

      const clusterMarker = L.marker([entry.lat, entry.lng], {
        icon: clusterIconFor(entry.items),
        keyboard: true,
        title: `${entry.items.length} alerts`
      });
      clusterMarker.on('click', () => {
        liveMap.fitBounds(L.latLngBounds(entry.items.map((item) => [item.lat, item.lng])), {
          padding: [26, 26],
          maxZoom: Math.min((liveMap.getZoom() || 3) + 2, mode === 'london' ? LONDON_CLUSTER_MAX_ZOOM : WORLD_CLUSTER_MAX_ZOOM)
        });
      });
      clusterMarker.addTo(liveMap);
      layers.push(clusterMarker);
      entry.items.forEach((item) => points.push([item.lat, item.lng]));
    });

    if (mapStatusLine) mapStatusLine.textContent = statusLine(mode, items.length);
    if (mapEmptyState) mapEmptyState.classList.toggle('hidden', items.length > 0);
    if (forceFit && mode === 'london' && !hasInitialLondonFrame) {
      hasInitialLondonFrame = true;
      liveMap.setView(LONDON_CENTER, INITIAL_LONDON_ZOOM);
      requestAnimationFrame(() => liveMap.invalidateSize());
      return;
    }
    fitForMode(mode, points);
    requestAnimationFrame(() => liveMap.invalidateSize());
  }

  function zoomMap(direction) {
    ensureMap();
    if (!liveMap) return;
    if (direction > 0) liveMap.zoomIn();
    if (direction < 0) liveMap.zoomOut();
  }

  function invalidateSize() {
    if (!liveMap) return;
    requestAnimationFrame(() => liveMap.invalidateSize());
  }

  function resetView() {
    if (!liveMap) return;
    if (lastMode === 'world') {
      liveMap.setView(WORLD_FALLBACK.center, WORLD_FALLBACK.zoom);
      return;
    }
    liveMap.fitBounds(LONDON_BOUNDS, { padding: [14, 14], maxZoom: 11 });
  }

  return {
    ensureMap,
    renderMap,
    zoomMap,
    invalidateSize,
    resetView
  };
}
