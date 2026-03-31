export function createMapController(config) {
  const {
    mapElement,
    mapSummary,
    mapLayerSummary,
    watchLayerLabels,
    openDetail
  } = config;

  let liveMap = null;
  let liveMarkers = [];
  let watchSiteMarkers = [];
  let lastMapSignature = '';
  let lastState = null;
  let lastView = null;

  function visibleWatchSites(state) {
    return state.watchGeographySites.filter((site) =>
      state.activeWatchLayers.has(site.category) &&
      (state.activeRegion === 'all' || site.region === state.activeRegion)
    );
  }

  function ensureMap() {
    if (liveMap || !mapElement || typeof L === 'undefined') return;
    liveMap = L.map(mapElement, {
      center: [20, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      zoomControl: false,
      worldCopyJump: true,
      attributionControl: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(liveMap);

    liveMap.on('zoomend moveend', () => {
      if (!lastState || !lastView) return;
      renderMap(lastState, lastView, false);
    });
  }

  function mapRingKind(alert) {
    if (!alert) return '';
    if (alert.incidentTrack === 'case' || ['charge', 'arrest', 'sentencing', 'recognition', 'feature'].includes(alert.eventType)) {
      return 'case';
    }
    if (alert.eventType === 'disrupted_plot') return 'disrupted';
    if (['active_attack', 'threat_update', 'incident_update'].includes(alert.eventType) || alert.incidentTrack === 'live') {
      return 'active';
    }
    return '';
  }

  function mapIconForAlert(alert) {
    const safeSeverity = ['critical', 'high', 'elevated', 'moderate'].includes(alert?.severity) ? alert.severity : 'moderate';
    const ringKind = mapRingKind(alert);
    const ringMarkup = ringKind ? `<span class="map-ring map-ring--${ringKind}"></span>` : '';
    return L.divIcon({
      className: 'map-pin-icon',
      html: `<span class="map-pin-shell">${ringMarkup}<span class="map-pin map-pin--${safeSeverity}"></span></span>`,
      iconSize: [42, 42],
      iconAnchor: [21, 32],
      popupAnchor: [0, -24]
    });
  }

  function watchSiteIcon(category) {
    return L.divIcon({
      className: 'watch-site-icon',
      html: `<span class="watch-site-marker watch-site-marker--${category}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -8]
    });
  }

  function clusterIconFor(items) {
    const highestSeverity = items
      .map((item) => item.severity)
      .find((severity) => severity === 'critical')
      || items.map((item) => item.severity).find((severity) => severity === 'high')
      || items.map((item) => item.severity).find((severity) => severity === 'elevated')
      || 'moderate';

    return L.divIcon({
      className: 'map-cluster-icon',
      html: `<span class="map-cluster map-cluster--${highestSeverity}">${items.length}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function clusterAlerts(items) {
    if (!liveMap || items.length <= 1) {
      return items.map((item) => ({ type: 'single', alert: item }));
    }

    const zoom = liveMap.getZoom();
    const threshold = zoom <= 3 ? 48 : zoom <= 5 ? 36 : 26;
    const clusters = [];

    items.forEach((alert) => {
      const point = liveMap.project(L.latLng(alert.lat, alert.lng), zoom);
      const match = clusters.find((cluster) => {
        const dx = cluster.center.x - point.x;
        const dy = cluster.center.y - point.y;
        return Math.hypot(dx, dy) <= threshold;
      });

      if (match) {
        match.items.push(alert);
        match.center.x = (match.center.x * (match.items.length - 1) + point.x) / match.items.length;
        match.center.y = (match.center.y * (match.items.length - 1) + point.y) / match.items.length;
      } else {
        clusters.push({
          center: { x: point.x, y: point.y },
          items: [alert]
        });
      }
    });

    return clusters.map((cluster) => {
      if (cluster.items.length === 1) {
        return { type: 'single', alert: cluster.items[0] };
      }
      const latLng = liveMap.unproject(L.point(cluster.center.x, cluster.center.y), zoom);
      return {
        type: 'cluster',
        lat: latLng.lat,
        lng: latLng.lng,
        items: cluster.items
      };
    });
  }

  function renderMap(state, view, forceFit = false) {
    ensureMap();
    if (!liveMap) return;
    lastState = state;
    lastView = view;

    liveMarkers.forEach((marker) => marker.remove());
    watchSiteMarkers.forEach((marker) => marker.remove());
    liveMarkers = [];
    watchSiteMarkers = [];

    const items = view.filtered.filter((alert) => Number.isFinite(alert.lat) && Number.isFinite(alert.lng));
    const clusteredItems = clusterAlerts(items);
    const sites = visibleWatchSites(state);
    const signature = [
      items.map((alert) => `${alert.id}:${alert.lat.toFixed(3)},${alert.lng.toFixed(3)}`).join('|'),
      String(liveMap.getZoom()),
      sites.map((site) => `${site.id}:${site.category}`).join('|')
    ].join('::');
    const bounds = [];

    clusteredItems.forEach((entry) => {
      if (entry.type === 'single') {
        const alert = entry.alert;
        const marker = L.marker([alert.lat, alert.lng], {
          icon: mapIconForAlert(alert),
          keyboard: true,
          title: alert.title
        });
        marker.on('click', () => openDetail(alert));
        marker.addTo(liveMap);
        liveMarkers.push(marker);
        bounds.push([alert.lat, alert.lng]);
        return;
      }

      const clusterMarker = L.marker([entry.lat, entry.lng], {
        icon: clusterIconFor(entry.items),
        keyboard: true,
        title: `${entry.items.length} incidents`
      });
      clusterMarker.on('click', () => {
        const clusterBounds = L.latLngBounds(entry.items.map((item) => [item.lat, item.lng]));
        liveMap.fitBounds(clusterBounds, {
          padding: [40, 40],
          maxZoom: Math.min((liveMap.getZoom() || 2) + 2, 8)
        });
      });
      clusterMarker.bindPopup(`
        <div class="watch-site-popup">
          <strong>${entry.items.length} grouped incidents</strong>
          <p>${entry.items.slice(0, 3).map((item) => item.title).join(' | ')}</p>
        </div>
      `);
      clusterMarker.addTo(liveMap);
      liveMarkers.push(clusterMarker);
      entry.items.forEach((item) => bounds.push([item.lat, item.lng]));
    });

    sites.forEach((site) => {
      const marker = L.marker([site.lat, site.lng], {
        icon: watchSiteIcon(site.category),
        keyboard: true,
        title: site.name
      });
      marker.bindPopup(`<div class="watch-site-popup"><strong>${site.name}</strong><p>${watchLayerLabels[site.category]} | ${site.note}</p></div>`);
      marker.addTo(liveMap);
      watchSiteMarkers.push(marker);
      bounds.push([site.lat, site.lng]);
    });

    const clusterCount = clusteredItems.filter((entry) => entry.type === 'cluster').length;
    mapSummary.textContent = `${view.responder.length} responder items | ${view.context.length} context | ${view.quarantine.length} quarantine | ${items.length} plotted alerts${clusterCount ? ` | ${clusterCount} clusters` : ''}`;
    mapLayerSummary.textContent = `${sites.length} watch sites visible`;

    if (items.length && (forceFit || signature !== lastMapSignature)) {
      liveMap.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: items.length === 1 ? 6 : 5
      });
    } else if (!items.length && sites.length && (forceFit || signature !== lastMapSignature)) {
      liveMap.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 5
      });
    } else if (!items.length && (forceFit || lastMapSignature)) {
      liveMap.setView([20, 10], 2);
    }

    lastMapSignature = signature;
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

  return {
    ensureMap,
    renderMap,
    zoomMap,
    invalidateSize
  };
}
