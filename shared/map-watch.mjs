import { escapeHtml } from '../app/utils/text.mjs';
import { MAP_VIEW_MODES } from './ui-constants.mjs';

const LONDON_CENTER = Object.freeze([51.5074, -0.1278]);
const LONDON_BOUNDS = Object.freeze([
  [51.28, -0.52],
  [51.7, 0.24]
]);
const INITIAL_LONDON_ZOOM = 12;
const WORLD_FALLBACK = Object.freeze({ center: [50.2, 10.4], zoom: 4 });
const LONDON_CLUSTER_MAX_ZOOM = 12;
const WORLD_CLUSTER_MAX_ZOOM = 7;
const FRESH_ALERT_WINDOW_MS = 90 * 60 * 1000;
const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const MAX_MAP_INIT_ATTEMPTS = 8;

let leafletLoadPromise = null;

function ensureLeafletAssets() {
  if (typeof document === 'undefined') return;
  const existingLink = document.querySelector('link[data-leaflet-css]');
  const hasLeafletStyles = existingLink || Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .some((link) => String(link.href || '').includes('leaflet'));
  if (!hasLeafletStyles) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS_URL;
    link.crossOrigin = '';
    link.dataset.leafletCss = 'true';
    document.head.appendChild(link);
  }
}

function ensureLeafletLoaded() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    ensureLeafletAssets();
    const script = document.createElement('script');
    script.src = LEAFLET_JS_URL;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletLoadPromise = null;
      reject(new Error('Leaflet failed to load'));
    };
    document.head.appendChild(script);
  });

  return leafletLoadPromise;
}

function statusLine(mode, count) {
  if (count <= 0) return 'No alerts in current view';
  const countLabel = `${count} alert${count === 1 ? '' : 's'}`;
  if (mode === MAP_VIEW_MODES.london) return `${countLabel} in London`;
  return `${countLabel} in last 24h`;
}

function severityClass(alert) {
  const severity = String(alert?.severity || '').toLowerCase();
  if (severity === 'critical' || severity === 'high' || severity === 'elevated') return severity;
  return 'moderate';
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

function normaliseCountryName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const aliasMap = new Map([
    ['uk', 'United Kingdom'],
    ['u.k.', 'United Kingdom'],
    ['united kingdom', 'United Kingdom'],
    ['great britain', 'United Kingdom'],
    ['britain', 'United Kingdom'],
    ['england', 'United Kingdom'],
    ['scotland', 'United Kingdom'],
    ['wales', 'United Kingdom'],
    ['northern ireland', 'United Kingdom'],
    ['united states', 'United States'],
    ['u.s.', 'United States'],
    ['u.s.a.', 'United States'],
    ['usa', 'United States'],
    ['us', 'United States']
  ]);
  if (aliasMap.has(lower)) return aliasMap.get(lower);
  return raw;
}

function countryLabelFromAlert(alert) {
  const location = String(alert?.location || '').trim();
  if (location.includes(',')) {
    const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return normaliseCountryName(parts[parts.length - 1]);
    }
  }

  if (location) return normaliseCountryName(location);

  const region = String(alert?.region || '').toLowerCase();
  if (region === 'uk' || region === 'london') return 'United Kingdom';
  if (region === 'us') return 'United States';
  return '';
}

function countryCodeFor(label) {
  const codeMap = new Map([
    ['United Kingdom', 'GBR'],
    ['United States', 'USA'],
    ['France', 'FRA'],
    ['Germany', 'DEU'],
    ['Italy', 'ITA'],
    ['Spain', 'ESP'],
    ['Belgium', 'BEL'],
    ['Netherlands', 'NLD'],
    ['Ireland', 'IRL'],
    ['Poland', 'POL'],
    ['Sweden', 'SWE'],
    ['Norway', 'NOR'],
    ['Denmark', 'DNK'],
    ['Finland', 'FIN'],
    ['Switzerland', 'CHE'],
    ['Austria', 'AUT'],
    ['Greece', 'GRC'],
    ['Turkey', 'TUR'],
    ['Russia', 'RUS'],
    ['Ukraine', 'UKR'],
    ['Israel', 'ISR'],
    ['Palestine', 'PSE'],
    ['Iraq', 'IRQ'],
    ['Iran', 'IRN'],
    ['Syria', 'SYR'],
    ['Afghanistan', 'AFG'],
    ['Pakistan', 'PAK'],
    ['India', 'IND'],
    ['China', 'CHN'],
    ['Japan', 'JPN'],
    ['Australia', 'AUS'],
    ['Canada', 'CAN'],
    ['Brazil', 'BRA'],
    ['Mexico', 'MEX'],
    ['South Africa', 'ZAF'],
    ['Nigeria', 'NGA'],
    ['Somalia', 'SOM'],
    ['Yemen', 'YEM'],
    ['Saudi Arabia', 'SAU'],
    ['United Arab Emirates', 'ARE'],
    ['Qatar', 'QAT'],
    ['Kuwait', 'KWT'],
    ['Egypt', 'EGY'],
    ['Libya', 'LBY'],
    ['Algeria', 'DZA'],
    ['Morocco', 'MAR'],
    ['Tunisia', 'TUN'],
    ['Philippines', 'PHL'],
    ['Indonesia', 'IDN'],
    ['Malaysia', 'MYS'],
    ['Bangladesh', 'BGD'],
    ['Sri Lanka', 'LKA'],
    ['Myanmar', 'MMR'],
    ['Thailand', 'THA'],
    ['Vietnam', 'VNM'],
    ['South Korea', 'KOR'],
    ['North Korea', 'PRK'],
    ['Czech Republic', 'CZE'],
    ['Czechia', 'CZE'],
    ['Romania', 'ROU'],
    ['Bulgaria', 'BGR'],
    ['Hungary', 'HUN'],
    ['Portugal', 'PRT'],
    ['Slovakia', 'SVK'],
    ['Slovenia', 'SVN'],
    ['Croatia', 'HRV'],
    ['Serbia', 'SRB'],
    ['Bosnia and Herzegovina', 'BIH'],
    ['Albania', 'ALB'],
    ['North Macedonia', 'MKD'],
    ['Montenegro', 'MNE'],
    ['Kosovo', 'XKX']
  ]);
  return codeMap.get(label) || '';
}

function countryStatsUrl(label) {
  const code = countryCodeFor(label);
  if (code) {
    return `https://ourworldindata.org/grapher/terrorist-attacks?tab=line&country=~${encodeURIComponent(code)}`;
  }
  return 'https://ourworldindata.org/terrorism';
}

function dominantCountryLabel(items) {
  const counts = new Map();
  items.forEach((alert) => {
    const label = countryLabelFromAlert(alert);
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  let best = '';
  let bestCount = 0;
  counts.forEach((count, label) => {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  });
  return best;
}

function clusterPopup(entry) {
  const items = entry.items || [];
  const topItems = items.slice(0, 6);
  const remaining = Math.max(0, items.length - topItems.length);
  const countryLabel = dominantCountryLabel(items);
  const statsUrl = countryLabel ? countryStatsUrl(countryLabel) : '';
  return `
    <div class="map-preview-card map-cluster-card">
      <span class="map-preview-eyebrow">${escapeHtml(items.length)} alerts${countryLabel ? ` • ${escapeHtml(countryLabel)}` : ''}</span>
      <div class="map-cluster-list">
        ${topItems.map((alert) => `
          <button class="map-cluster-item" type="button" data-open-detail="${escapeHtml(alert.id)}">
            <strong>${escapeHtml(alert.title)}</strong>
            <span>${escapeHtml(alert.location || 'Unknown location')}</span>
          </button>
        `).join('')}
        ${remaining ? `<span class="map-cluster-more">+${remaining} more alerts</span>` : ''}
      </div>
      <div class="map-cluster-actions">
        ${statsUrl ? `<a class="map-cluster-link" href="${statsUrl}" target="_blank" rel="noreferrer">Country terrorism stats</a>` : ''}
        <button class="map-preview-button" type="button" data-zoom-cluster="true">Zoom in</button>
      </div>
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

function alertPublishedAtMs(alert) {
  const stamp = alert?.publishedAt || alert?.updatedAt || alert?.firstReportedAt || null;
  const timeMs = stamp ? new Date(stamp).getTime() : NaN;
  return Number.isFinite(timeMs) ? timeMs : NaN;
}

function isFreshAlert(alert, nowMs = Date.now()) {
  const publishedAtMs = alertPublishedAtMs(alert);
  return Number.isFinite(publishedAtMs) && (nowMs - publishedAtMs) >= 0 && (nowMs - publishedAtMs) <= FRESH_ALERT_WINDOW_MS;
}

export function createMapController(config) {
  const { mapElement, mapStatusLine, mapEmptyState, openDetail } = config;
  let liveMap = null;
  let layers = [];
  let lastSignature = '';
  let lastMode = MAP_VIEW_MODES.world;
  let lastState = null;
  let lastView = null;
  let hasInitialLondonFrame = false;
  let initAttempts = 0;
  let isLoadingLeaflet = false;

  function ensureMap() {
    if (liveMap || !mapElement) return;
    if (typeof window !== 'undefined' && !window.L) {
      if (!isLoadingLeaflet) {
        isLoadingLeaflet = true;
        if (mapStatusLine) mapStatusLine.textContent = 'Loading map...';
        ensureLeafletLoaded()
          .then(() => {
            isLoadingLeaflet = false;
            ensureMap();
            if (lastState && lastView) {
              renderMap(lastState, lastView, true);
            }
          })
          .catch(() => {
            isLoadingLeaflet = false;
            if (mapStatusLine) mapStatusLine.textContent = 'Map failed to load. Please refresh.';
          });
      }
      return;
    }

    const rect = mapElement.getBoundingClientRect();
    if ((rect.width <= 0 || rect.height <= 0) && initAttempts < MAX_MAP_INIT_ATTEMPTS) {
      initAttempts += 1;
      setTimeout(ensureMap, 120);
      return;
    }
    initAttempts = 0;

    if (typeof L === 'undefined') return;
    liveMap = L.map(mapElement, {
      center: WORLD_FALLBACK.center,
      zoom: WORLD_FALLBACK.zoom,
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
    const freshClass = isFreshAlert(alert) ? ' map-dot--fresh' : '';
    return L.divIcon({
      className: 'map-dot-icon',
      html: `<span class="map-dot map-dot--${level}${freshClass}" aria-hidden="true"></span>`,
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
    const mode = state.mapViewMode === MAP_VIEW_MODES.world ? MAP_VIEW_MODES.world : MAP_VIEW_MODES.london;
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
      clusterMarker.bindPopup(clusterPopup(entry), { className: 'map-preview-popup-shell' });
      clusterMarker.on('popupopen', (event) => {
        const popupElement = event.popup?.getElement();
        if (!popupElement) return;
        popupElement.querySelectorAll('[data-open-detail]').forEach((button) => {
          const id = button.getAttribute('data-open-detail');
          const alert = entry.items.find((item) => String(item.id) === String(id));
          if (!alert) return;
          button.addEventListener('click', () => openDetail(alert), { once: true });
        });
        const zoomButton = popupElement.querySelector('[data-zoom-cluster]');
        if (zoomButton) {
          zoomButton.addEventListener('click', () => {
            liveMap.fitBounds(L.latLngBounds(entry.items.map((item) => [item.lat, item.lng])), {
              padding: [26, 26],
              maxZoom: Math.min((liveMap.getZoom() || 3) + 2, mode === MAP_VIEW_MODES.london ? LONDON_CLUSTER_MAX_ZOOM : WORLD_CLUSTER_MAX_ZOOM)
            });
          }, { once: true });
        }
      });
      clusterMarker.addTo(liveMap);
      layers.push(clusterMarker);
      entry.items.forEach((item) => points.push([item.lat, item.lng]));
    });

    if (mapStatusLine) mapStatusLine.textContent = statusLine(mode, items.length);
    if (mapEmptyState) mapEmptyState.classList.toggle('hidden', items.length > 0);
    if (forceFit && mode === MAP_VIEW_MODES.london && !hasInitialLondonFrame) {
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
    if (lastMode === MAP_VIEW_MODES.world) {
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
