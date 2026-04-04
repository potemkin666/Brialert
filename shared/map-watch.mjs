export function createMapController(config) {
  const {
    mapElement,
    mapSummary,
    mapPostureChip,
    mapLayerSummary,
    watchLayerLabels,
    openDetail
  } = config;

  let liveMap = null;
  let liveMarkers = [];
  let watchSiteMarkers = [];
  let watchZoneLayers = [];
  let fusionLayers = [];
  let lastDataSignature = '';
  let lastRenderZoom = null;
  let lastRenderCenterSignature = '';
  let lastState = null;
  let lastView = null;

  const LONDON_VIEW = Object.freeze({ center: [51.5074, -0.1278], zoom: 10 });
  const MAP_POPUP_SUMMARY_MAX = 120;
  const UK_BOUNDS = Object.freeze([
    [49.8, -8.7],
    [60.95, 1.9]
  ]);
  const EUROPE_BOUNDS = Object.freeze([
    [35.0, -11.0],
    [71.5, 31.5]
  ]);
  const GLOBAL_FALLBACK = Object.freeze({ center: [20, 10], zoom: 2 });

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const watchZoneConfig = {
    transport: { radius: 900, color: '#53b6ff', fillOpacity: 0.07 },
    embassy: { radius: 550, color: '#c46bff', fillOpacity: 0.08 },
    hospital: { radius: 500, color: '#48c97d', fillOpacity: 0.07 },
    worship: { radius: 380, color: '#f0c95e', fillOpacity: 0.07 },
    government: { radius: 700, color: '#ff7a64', fillOpacity: 0.08 }
  };

  function isLondonCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 51.28 && lat <= 51.70 && lng >= -0.52 && lng <= 0.24;
  }

  function visibleWatchSites(state) {
    return state.watchGeographySites.filter((site) =>
      state.activeWatchLayers.has(site.category) &&
      (
        state.activeRegion === 'all'
        || (state.activeRegion === 'london' ? isLondonCoordinate(site.lat, site.lng) : site.region === state.activeRegion)
      )
    );
  }

  function ensureMap() {
    if (liveMap || !mapElement || typeof L === 'undefined') return;
    liveMap = L.map(mapElement, {
      center: LONDON_VIEW.center,
      zoom: LONDON_VIEW.zoom,
      minZoom: 2,
      maxZoom: 12,
      zoomControl: false,
      worldCopyJump: true,
      attributionControl: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(liveMap);

    liveMap.on('zoomend', () => {
      if (!lastState || !lastView) return;
      renderMap(lastState, lastView, false);
    });
  }

  function mapPostureLabel(state, hasAlertMarkers) {
    if (!hasAlertMarkers) return 'London standby posture';
    if (state.activeRegion === 'london') return 'London operational view';
    if (state.activeRegion === 'uk') return 'UK operational view';
    if (state.activeRegion === 'europe') return 'EU operational view';
    return 'Filtered incident posture';
  }

  function resetToContextDefault(state, markerBounds) {
    if (!liveMap) return;

    if (markerBounds?.isValid?.()) {
      liveMap.fitBounds(markerBounds, {
        padding: [32, 32],
        maxZoom: state.activeRegion === 'london' ? 11 : 8
      });
      return;
    }

    if (state.activeRegion === 'london') {
      liveMap.setView(LONDON_VIEW.center, LONDON_VIEW.zoom);
      return;
    }

    if (state.activeRegion === 'uk') {
      liveMap.fitBounds(UK_BOUNDS, { padding: [30, 30], maxZoom: 7 });
      return;
    }

    if (state.activeRegion === 'europe') {
      liveMap.fitBounds(EUROPE_BOUNDS, { padding: [30, 30], maxZoom: 6 });
      return;
    }

    liveMap.setView(GLOBAL_FALLBACK.center, GLOBAL_FALLBACK.zoom);
  }

  function mapMarkerKind(alert) {
    if (!alert) return '';
    if (alert.lane === 'context' || alert.eventType === 'context_update' || ['context', 'research'].includes(alert.sourceTier)) {
      return 'context';
    }
    if (alert.incidentTrack === 'case' || ['charge', 'arrest', 'sentencing', 'recognition', 'feature'].includes(alert.eventType)) {
      return 'arrest';
    }
    if (alert.eventType === 'disrupted_plot') return 'disrupted';
    if (['active_attack', 'threat_update', 'incident_update'].includes(alert.eventType) || alert.incidentTrack === 'live') {
      return 'active';
    }
    return alert.lane === 'incidents' ? 'active' : 'context';
  }

  function markerGlyph(kind) {
    if (kind === 'disrupted') return 'X';
    if (kind === 'arrest') return 'A';
    if (kind === 'context') return 'i';
    return '!';
  }

  function mapIconForAlert(alert) {
    const safeSeverity = ['critical', 'high', 'elevated', 'moderate'].includes(alert?.severity) ? alert.severity : 'moderate';
    const markerKind = mapMarkerKind(alert);
    const ringMarkup = markerKind ? `<span class="map-ring map-ring--${markerKind}"></span>` : '';
    const glyphMarkup = `<span class="map-pin-glyph map-pin-glyph--${markerKind}" aria-hidden="true">${markerGlyph(markerKind)}</span>`;
    return L.divIcon({
      className: 'map-pin-icon',
      html: `<span class="map-pin-shell map-pin-shell--${markerKind}">${ringMarkup}<span class="map-pin map-pin--${safeSeverity} map-pin--${markerKind}"></span>${glyphMarkup}</span>`,
      iconSize: [42, 42],
      iconAnchor: [21, 32],
      popupAnchor: [0, -24]
    });
  }

  function watchSiteIcon(category) {
    const glyphs = {
      transport: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="5.5" width="12" height="9" rx="2.5"></rect>
          <path d="M8.5 16.5h7"></path>
          <path d="M9 9h2.5"></path>
          <path d="M12.5 9h2.5"></path>
          <path d="M9.5 18.5l-1.5 2"></path>
          <path d="M14.5 18.5l1.5 2"></path>
          <circle cx="9.5" cy="15.5" r="1"></circle>
          <circle cx="14.5" cy="15.5" r="1"></circle>
        </svg>`,
      embassy: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 9.5L12 6l7 3.5"></path>
          <path d="M6.5 9.5h11"></path>
          <path d="M7.5 10v6"></path>
          <path d="M11 10v6"></path>
          <path d="M13 10v6"></path>
          <path d="M16.5 10v6"></path>
          <path d="M6 17h12"></path>
        </svg>`,
      hospital: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 6.5v11"></path>
          <path d="M6.5 12h11"></path>
        </svg>`,
      worship: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5.5l1.8 4 4.2.4-3.2 2.8 1 4.3-3.8-2.2-3.8 2.2 1-4.3-3.2-2.8 4.2-.4z"></path>
        </svg>`,
      government: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5.5l6.5 2.5v4.5c0 3.7-2.4 5.9-6.5 7.8-4.1-1.9-6.5-4.1-6.5-7.8V8z"></path>
          <path d="M9 11.5h6"></path>
          <path d="M9 14.5h4.5"></path>
        </svg>`
    };
    return L.divIcon({
      className: 'watch-site-icon',
      html: `<span class="watch-site-marker watch-site-marker--${category}"><span class="watch-site-glyph">${glyphs[category] || glyphs.government}</span></span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12]
    });
  }

  function previewSummary(alert) {
    return String(alert.summary || alert.aiSummary || alert.title || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  function truncatedSummary(summary, max = MAP_POPUP_SUMMARY_MAX) {
    return `${summary.slice(0, max)}${summary.length > max ? '...' : ''}`;
  }

  function signatureValue(value) {
    return value ?? '';
  }

  function markerPreviewTooltip(alert) {
    return `<div class="map-preview-tooltip"><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.source)} | ${escapeHtml(alert.time)}</span></div>`;
  }

  function markerPreviewPopup(alert) {
    const summary = previewSummary(alert);
    return `
      <div class="map-preview-card">
        <p class="map-preview-eyebrow">${escapeHtml(alert.lane)} | ${escapeHtml(alert.location)}</p>
        <strong>${escapeHtml(alert.title)}</strong>
        <p>${escapeHtml(truncatedSummary(summary))}</p>
        <div class="map-preview-meta">
          <span>${escapeHtml(alert.source)}</span>
          <span>${escapeHtml(alert.time)}</span>
        </div>
        <button class="map-preview-button" type="button" data-open-detail="${alert.id}">Open full detail</button>
      </div>`;
  }

  function watchZoneForSite(site) {
    const config = watchZoneConfig[site.category] || watchZoneConfig.government;
    return L.circle([site.lat, site.lng], {
      radius: config.radius,
      stroke: true,
      color: config.color,
      weight: 1.25,
      opacity: 0.45,
      fillColor: config.color,
      fillOpacity: config.fillOpacity,
      interactive: false,
      className: `watch-zone watch-zone--${site.category}`
    });
  }

  function fusionSatellitesFor(alert) {
    if (!liveMap || !Array.isArray(alert?.corroboratingSources) || !alert.corroboratingSources.length) {
      return [];
    }

    const sourceCount = Math.min(alert.corroboratingSources.length, 4);
    const center = liveMap.project(L.latLng(alert.lat, alert.lng), liveMap.getZoom());
    const radius = sourceCount > 2 ? 28 : 24;
    const angleStep = (Math.PI * 2) / sourceCount;

    return alert.corroboratingSources.slice(0, sourceCount).map((source, index) => {
      const angle = (-Math.PI / 2) + (index * angleStep);
      const point = L.point(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius
      );
      const latLng = liveMap.unproject(point, liveMap.getZoom());
      return {
        source,
        lat: latLng.lat,
        lng: latLng.lng
      };
    });
  }

  function renderFusionForAlert(alert) {
    if (!liveMap || liveMap.getZoom() < 5) return;
    const satellites = fusionSatellitesFor(alert);
    satellites.forEach(({ source, lat, lng }) => {
      const line = L.polyline(
        [
          [alert.lat, alert.lng],
          [lat, lng]
        ],
        {
          color: '#8fd3ff',
          weight: 1.25,
          opacity: 0.42,
          dashArray: '4 4',
          interactive: false,
          className: 'fusion-line'
        }
      );
      line.addTo(liveMap);
      fusionLayers.push(line);

      const endpoint = L.circleMarker([lat, lng], {
        radius: 4,
        color: '#e8f1ff',
        weight: 1,
        fillColor: '#5fa8ff',
        fillOpacity: 0.9,
        className: 'fusion-node'
      });
      endpoint.bindPopup(`<div class="watch-site-popup"><strong>${escapeHtml(source.source || 'Corroborating source')}</strong><p>${escapeHtml(source.confidence || 'Attached corroboration')}${source.sourceTier ? ` | ${escapeHtml(source.sourceTier)}` : ''}</p></div>`);
      endpoint.addTo(liveMap);
      fusionLayers.push(endpoint);
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
    const threshold = zoom <= 3 ? 50 : zoom <= 5 ? 38 : zoom <= 7 ? 30 : 24;
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

    const items = view.filtered.filter((alert) => Number.isFinite(alert.lat) && Number.isFinite(alert.lng));
    const sites = visibleWatchSites(state);
    const dataSignature = [
      items.map((alert) => `${alert.id}:${alert.lat.toFixed(3)},${alert.lng.toFixed(3)}:${signatureValue(alert.status)}:${signatureValue(alert.sourceTier)}:${signatureValue(alert.eventType)}`).join('|'),
      sites.map((site) => `${site.id}:${site.category}`).join('|')
    ].join('::');
    const zoom = liveMap.getZoom();
    const dataChanged = dataSignature !== lastDataSignature;
    const zoomChanged = zoom !== lastRenderZoom;

    const center = liveMap.getCenter();
    const centerSignature = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
    const centerChanged = centerSignature !== lastRenderCenterSignature;

    if (!forceFit && !dataChanged && !zoomChanged && !centerChanged) {
      return;
    }

    liveMarkers.forEach((marker) => marker.remove());
    watchSiteMarkers.forEach((marker) => marker.remove());
    watchZoneLayers.forEach((layer) => layer.remove());
    fusionLayers.forEach((layer) => layer.remove());
    liveMarkers = [];
    watchSiteMarkers = [];
    watchZoneLayers = [];
    fusionLayers = [];

    const clusteredItems = clusterAlerts(items);
    const allBoundsPoints = [];
    const alertBoundsPoints = [];
    const zoomLevel = liveMap.getZoom();
    const showWatchZones = zoomLevel >= 4;
    const showFusion = zoomLevel >= 5 && items.length <= 30;

    clusteredItems.forEach((entry) => {
      if (entry.type === 'single') {
        const alert = entry.alert;
        const marker = L.marker([alert.lat, alert.lng], {
          icon: mapIconForAlert(alert),
          keyboard: true,
          title: alert.title
        });
        marker.bindTooltip(markerPreviewTooltip(alert), {
          direction: 'top',
          offset: [0, -24],
          opacity: 0.96,
          className: 'map-preview-tooltip-shell'
        });
        marker.bindPopup(markerPreviewPopup(alert), {
          closeButton: true,
          autoPan: true,
          className: 'map-preview-popup-shell'
        });
        marker.on('mouseover', () => marker.openTooltip());
        marker.on('mouseout', () => marker.closeTooltip());
        marker.on('popupopen', (event) => {
          const popupElement = event.popup?.getElement();
          const button = popupElement?.querySelector(`[data-open-detail="${alert.id}"]`);
          if (!button) return;
          button.addEventListener('click', () => openDetail(alert), { once: true });
        });
        marker.addTo(liveMap);
        liveMarkers.push(marker);
        if (showFusion) {
          renderFusionForAlert(alert);
        }
        alertBoundsPoints.push([alert.lat, alert.lng]);
        allBoundsPoints.push([alert.lat, alert.lng]);
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
          <p>${entry.items.slice(0, 3).map((item) => escapeHtml(item.title)).join(' | ')}</p>
        </div>
      `);
      clusterMarker.addTo(liveMap);
      liveMarkers.push(clusterMarker);
      entry.items.forEach((item) => {
        alertBoundsPoints.push([item.lat, item.lng]);
        allBoundsPoints.push([item.lat, item.lng]);
      });
    });

    sites.forEach((site) => {
      if (showWatchZones) {
        const zone = watchZoneForSite(site);
        zone.addTo(liveMap);
        watchZoneLayers.push(zone);
      }

      const marker = L.marker([site.lat, site.lng], {
        icon: watchSiteIcon(site.category),
        keyboard: true,
        title: site.name
      });
      marker.bindPopup(`<div class="watch-site-popup"><strong>${escapeHtml(site.name)}</strong><p>${escapeHtml(watchLayerLabels[site.category])} | ${escapeHtml(site.note)}</p></div>`);
      marker.addTo(liveMap);
      watchSiteMarkers.push(marker);
      allBoundsPoints.push([site.lat, site.lng]);
    });

    const clusterCount = clusteredItems.filter((entry) => entry.type === 'cluster').length;
    const filterSuffix = Array.isArray(view.mapFilterLabels) && view.mapFilterLabels.length
      ? ` | ${view.mapFilterLabels.join(' + ')}`
      : '';
    mapSummary.textContent = `${items.length} plotted alerts${clusterCount ? ` | ${clusterCount} clusters` : ''}${filterSuffix}`;
    mapLayerSummary.textContent = `${sites.length} watch sites visible`;
    if (mapPostureChip) {
      mapPostureChip.textContent = mapPostureLabel(state, items.length > 0);
    }

    if (forceFit || dataChanged) {
      const markerBounds = alertBoundsPoints.length ? L.latLngBounds(alertBoundsPoints) : null;
      const allBounds = allBoundsPoints.length ? L.latLngBounds(allBoundsPoints) : null;

      if (state.activeRegion === 'all' && markerBounds?.isValid?.()) {
        liveMap.fitBounds(markerBounds, {
          padding: [30, 30],
          maxZoom: markerBounds.getSouthWest().equals(markerBounds.getNorthEast()) ? 10 : 8
        });
      } else if (markerBounds?.isValid?.()) {
        resetToContextDefault(state, markerBounds);
      } else if (!items.length && allBounds?.isValid?.() && state.activeRegion !== 'all') {
        liveMap.fitBounds(allBounds, {
          padding: [28, 28],
          maxZoom: state.activeRegion === 'london' ? 10 : 7
        });
      } else if (!items.length) {
        // Empty feed/filtered-empty standby should remain London-first.
        liveMap.setView(LONDON_VIEW.center, LONDON_VIEW.zoom);
      } else {
        resetToContextDefault(state, markerBounds);
      }
    }

    lastDataSignature = dataSignature;
    lastRenderZoom = liveMap.getZoom();
    const nextCenter = liveMap.getCenter();
    lastRenderCenterSignature = `${nextCenter.lat.toFixed(3)},${nextCenter.lng.toFixed(3)}`;
    if (forceFit || dataChanged) {
      requestAnimationFrame(() => liveMap.invalidateSize());
    }
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
